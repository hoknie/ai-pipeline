import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  launchProcess,
  missingSkills,
  timesPath,
  type ProcessExit,
  type SupervisedProcess,
} from '../../../agents/services/index.ts';
import { expandMcpServers, type Runtime } from '../../../agents/types/index.ts';
import { modelIdProblem, type Specialist } from '../../../swarm-config/types/index.ts';
import { attemptDirectory } from '../../../../platform/git/index.ts';
import {
  SPLIT_GROUP,
  findGroup,
  isRepairGroup,
  specialistOfStep,
  stepsOf,
  type Attempt,
  type Group,
  type RunState,
} from '../../types/index.ts';
import { NETWORK_FRESH_MS } from '../../../network/types/index.ts';

import type { ActionRunner } from './actions.ts';
import type { AttemptKey, EffectDependencies } from './context.ts';
import { withProxy } from './proxy.ts';
import { runtimeProblem } from './runtime-check.ts';
import type { OutsideChanges } from './outside.ts';
import type { RunningAgents } from './running.ts';
import type { UsageBuffers } from './usage.ts';
import { ensureGroupWorktree, logPath, workspaceOf } from './worktrees.ts';

/** What an attempt starts with once its runtime, tree and specialist are known. */
interface Prepared {
  state: RunState;
  group: Group;
  attempt: Attempt;
  key: AttemptKey;
  runtime: Runtime;
  worktree: string;
  specialist: Specialist;
}

/** The parts of the effects an attempt of a specialist uses. */
export interface AttemptParts {
  running: RunningAgents;
  usage: UsageBuffers;
  outside: OutsideChanges;
  actions: ActionRunner;
}

/** Starts the agent of an attempt and turns its exit into an event of the run. */
export class AttemptStarter {
  private readonly dependencies: EffectDependencies;
  private readonly parts: AttemptParts;

  constructor(dependencies: EffectDependencies, parts: AttemptParts) {
    this.dependencies = dependencies;
    this.parts = parts;
  }

  async start(state: RunState, slug: string, seq: number): Promise<void> {
    const prepared = await this.prepare(state, slug, seq);
    if (prepared === null) return;
    const { group, key, specialist, runtime, worktree } = prepared;
    const directory = attemptDirectory(workspaceOf(state), state.run.id, slug, seq);
    const log = logPath(state, slug, seq);
    mkdirSync(directory, { recursive: true });
    for (const skill of missingSkills(
      specialist.skills,
      runtime.skillDirectories(worktree, homedir()),
    )) {
      appendFileSync(log, `[aip] warning: skill not found: ${skill}\n`);
    }
    const token = this.parts.running.issueToken(key);
    await this.parts.outside.begin(state, key);
    const process = this.launch(prepared, directory, token);
    const timer = setTimeout(() => {
      if (this.dependencies.context.stopping) return;
      const { context } = this.dependencies;
      void context.serial(() => context.apply(state, { kind: 'timed_out', group: slug, seq }));
    }, specialist.timeoutSeconds * this.dependencies.timings.timeoutUnitMs);
    this.parts.running.add(key, process, timer);
    void process.exited.then((exit) => {
      clearTimeout(timer);
      this.parts.usage.drop(key);
      this.parts.running.remove(key);
      if (process.pid !== undefined) {
        this.dependencies.agentExit.agentGone({ pid: process.pid, ...key });
      }
      this.parts.running.dropToken(token);
      if (this.dependencies.context.stopping) return undefined;
      return this.networkFailure(state, key, exit).then((network) =>
        this.dependencies.context.serial(() => this.exited(state, group, key, exit, network)),
      );
    });
  }

  /** The runtime, the tree and the specialist of the attempt; null when it cannot start. */
  private async prepare(state: RunState, slug: string, seq: number): Promise<Prepared | null> {
    const group = findGroup(state, slug);
    const attempt = group?.attempts.find((candidate) => candidate.seq === seq);
    if (!group || !attempt || attempt.runtime === 'command') return null;
    const key = { run: state.run.id, group: slug, seq };
    const modelProblem = modelIdProblem(attempt.runtime, attempt.model);
    if (modelProblem) {
      await this.fail(state, key, {
        kind: 'spawn',
        message: `attempt ${seq} for ${attempt.specialist}: ${modelProblem}`,
      });
      return null;
    }
    const problem = runtimeProblem(this.dependencies, state.run.repository, attempt.runtime);
    if (problem) {
      await this.fail(state, key, problem);
      return null;
    }
    const { config, agents, environment } = this.dependencies;
    const settings = config.runtimeSettings(state.run.repository);
    if (typeof settings === 'string') return null;
    const runtime = agents.runtimeFor(attempt.runtime, settings);
    let worktree: string;
    try {
      worktree = await ensureGroupWorktree(state, group);
    } catch (error) {
      await this.fail(state, key, { kind: 'git', message: (error as Error).message });
      return null;
    }
    // Not into a network that is known to be down: the attempt waits and starts again later.
    const network = await this.dependencies.network.ensureFresh(NETWORK_FRESH_MS);
    if (network.state === 'down') {
      await this.fail(state, key, {
        kind: 'network',
        problem: network.problem ?? 'network is down',
      });
      return null;
    }
    // Leftovers of an interrupted check must not reach this one.
    await this.parts.actions.discardChanges(state, group);
    // The observer works from the snapshot of its profile, which is not in the configuration.
    const step = stepsOf(state.run, group)[attempt.stepIndex];
    const specialist = specialistOfStep(
      state.run,
      group,
      step ?? { specialist: attempt.specialist },
    );
    if (!specialist) {
      if (isRepairGroup(group)) {
        await this.fail(state, key, { kind: 'spawn', message: 'the observer has no profile' });
      }
      return null;
    }
    // `${NAME}` of the MCP servers is replaced only here: the snapshot of the run keeps the text.
    if (specialist.mcp === undefined)
      return { state, group, attempt, key, runtime, worktree, specialist };
    const expanded = expandMcpServers(specialist.mcp, {
      ...environment,
      ...settings[attempt.runtime as Specialist['runtime']].env,
    });
    if (!expanded.ok) {
      await this.fail(state, key, { kind: 'spawn', message: expanded.error });
      return null;
    }
    const resolved = { ...specialist, mcp: expanded.servers };
    return { state, group, attempt, key, runtime, worktree, specialist: resolved };
  }

  private launch(prepared: Prepared, directory: string, token: string): SupervisedProcess {
    const { state, group, attempt, key, runtime, worktree, specialist } = prepared;
    const { context, entry, socket, environment, graceMs, timings } = this.dependencies;
    const effectiveSpecialist: Specialist = {
      ...specialist,
      runtime: attempt.runtime as Specialist['runtime'],
      model: attempt.model,
      ...(attempt.variant !== undefined ? { variant: attempt.variant } : {}),
      ...(attempt.reasoningEffort !== undefined
        ? { reasoningEffort: attempt.reasoningEffort }
        : {}),
    };
    const launch = runtime.buildLaunch({
      specialist: effectiveSpecialist,
      input: attempt.input,
      worktree,
      attemptDirectory: directory,
      workerCommand: [
        ...entry,
        'mcp',
        '--worker',
        token,
        '--socket',
        socket,
        ...(group.slug === SPLIT_GROUP ? ['--split'] : []),
        ...(specialist.queue === true ? ['--queue'] : []),
        ...(isRepairGroup(group) ? ['--repair'] : []),
      ],
      sessionId: randomUUID(),
      resumeSession: attempt.resumeSession,
      claudeEditMode: state.run.config.claude.editMode,
      claudeMcp: state.run.config.claude.mcp,
      claudeSettings: state.run.config.claude.settings,
    });
    if (launch.sessionId) attempt.sessionId = launch.sessionId;
    context.save(state);
    const log = logPath(state, group.slug, key.seq);
    return launchProcess(launch, {
      cwd: worktree,
      logPath: log,
      parser: runtime.createParser(),
      environment: withProxy(environment, this.dependencies.network.proxy()),
      graceMs,
      drainMs: timings.drainMs,
      timesPath: timesPath(log),
      onUsage: (usage) => this.parts.usage.report(state, key, usage),
    });
  }

  /**
   * Why an agent that ended without a report may have ended because of the network: the problem,
   * or null. The check runs after the exit and outside the queue, so a slow probe holds nothing.
   */
  private async networkFailure(
    state: RunState,
    key: AttemptKey,
    exit: ProcessExit,
  ): Promise<string | null> {
    if (exit.spawnError || exit.outcome.usageLimit) return null;
    const attempt = findGroup(state, key.group)?.attempts.find((item) => item.seq === key.seq);
    if (!attempt || attempt.status !== 'running' || attempt.reason !== null) return null;
    if (attempt.report !== null) return null;
    if (exit.outcome.networkError) return exit.outcome.networkError;
    let snapshot;
    try {
      snapshot = await this.dependencies.network.checkNow();
    } catch {
      return null;
    }
    return snapshot.state === 'down' ? (snapshot.problem ?? 'network is down') : null;
  }

  /** The exit of the agent as an event: its session, usage, failure and changes outside. */
  private async exited(
    state: RunState,
    group: Group,
    key: AttemptKey,
    exit: ProcessExit,
    network: string | null,
  ): Promise<void> {
    await this.parts.actions.discardChanges(state, group);
    const outsideChanges = await this.parts.outside.finish(state, key);
    await this.dependencies.context.apply(state, {
      kind: 'attempt_exited',
      group: key.group,
      seq: key.seq,
      exit: {
        sessionId: exit.outcome.sessionId,
        usage: exit.outcome.usage,
        failure: exit.spawnError
          ? { kind: 'spawn', message: exit.spawnError }
          : exit.outcome.usageLimit
            ? { kind: 'usage_limit', resetsAt: exit.outcome.usageLimit.resetsAt }
            : network !== null
              ? { kind: 'network', problem: network }
              : null,
        outsideChanges,
        denials: exit.outcome.denials,
        onLimit: this.dependencies.queue.onLimitOf(state.run.repository),
      },
    });
  }

  private async fail(
    state: RunState,
    key: AttemptKey,
    failure: NonNullable<Attempt['reason']>,
  ): Promise<void> {
    this.parts.outside.forget(key);
    await this.dependencies.context.apply(state, {
      kind: 'attempt_exited',
      group: key.group,
      seq: key.seq,
      exit: { sessionId: null, usage: null, failure, outsideChanges: [] },
    });
  }
}
