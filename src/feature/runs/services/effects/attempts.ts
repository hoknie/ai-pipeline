import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import {
  launchProcess,
  timesPath,
  type ProcessExit,
  type SupervisedProcess,
} from '../../../agents/services/index.ts';
import {
  modelIdProblem,
  type McpServer,
  type Specialist,
} from '../../../swarm-config/types/index.ts';
import { attemptDirectory } from '../../../../platform/git/index.ts';
import {
  LESSON_SKILL_NAME,
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
import type { AttemptKey, EffectDependencies, Prepared } from './context.ts';
import {
  conversationFolder,
  effectiveSpecialist,
  purgeConversations,
  connectedSpecialist,
  startWithRegistryProject,
  withBridges,
  workerCommand,
} from './conversations.ts';
import { logSkillWarnings, startWithSkills, type AttemptSkills } from './skills/index.ts';
import { networkFailure, runtimeProblem, withProxy } from './runtime-check.ts';
import type { OutsideChanges } from './outside.ts';
import type { RunningAgents } from './running.ts';
import type { UsageBuffers } from './usage.ts';
import { ensureGroupWorktree, logPath, workspaceOf } from './worktrees.ts';

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

  /** Starts the attempt; the wait for the registry project happens outside the queue. */
  async start(state: RunState, slug: string, seq: number): Promise<void> {
    return startWithRegistryProject(this.dependencies, state, slug, seq, () =>
      this.startNow(state, slug, seq),
    );
  }

  private async startNow(state: RunState, slug: string, seq: number): Promise<void> {
    const prepared = await this.prepare(state, slug, seq);
    if (prepared === null) return;
    const { key, specialist, runtime } = prepared;
    const directory = attemptDirectory(workspaceOf(state), state.run.id, slug, seq);
    mkdirSync(directory, { recursive: true });
    const lessons = this.dependencies.lessons.block(state.run.repository, specialist.slug);
    // the network of the registry runs outside the serial queue, inside `startWithSkills`
    await startWithSkills(
      this.dependencies,
      state,
      key,
      specialist,
      runtime,
      lessons,
      directory,
      (skills) => this.begin(prepared, directory, logPath(state, slug, seq), skills),
      (message) => this.fail(state, key, { kind: 'spawn', message }),
    );
  }

  /** Writes the warnings, issues the token and launches the agent. */
  private async begin(
    prepared: Prepared,
    directory: string,
    log: string,
    skills: AttemptSkills,
  ): Promise<void> {
    const { state, group, key, specialist, runtime, worktree } = prepared;
    logSkillWarnings(log, specialist, runtime, worktree, skills);
    const token = this.parts.running.issueToken(key);
    await this.parts.outside.begin(state, key);
    let process: SupervisedProcess;
    try {
      process = this.launch(prepared, directory, token, skills.directory, skills.lessons === true);
    } catch (error) {
      this.release(token);
      await this.fail(state, key, { kind: 'spawn', message: (error as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      if (this.dependencies.context.stopping) return;
      const { context } = this.dependencies;
      void context.serial(() =>
        context.apply(state, { kind: 'timed_out', group: key.group, seq: key.seq }),
      );
    }, specialist.timeoutSeconds * this.dependencies.timings.timeoutUnitMs);
    this.parts.running.add(key, process, timer);
    void process.exited.then((exit) => {
      clearTimeout(timer);
      this.parts.usage.drop(key);
      this.parts.running.remove(key);
      if (process.pid !== undefined) {
        this.dependencies.agentExit.agentGone({ pid: process.pid, ...key });
      }
      this.release(token);
      if (this.dependencies.context.stopping) return undefined;
      return networkFailure(this.dependencies.network, state, key, exit).then((network) =>
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
    const { config, agents } = this.dependencies;
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
    let attachments: string | null = null;
    if (state.run.attachments.length > 0) {
      try {
        attachments = await this.dependencies.attachments.materialize(state.run);
      } catch (error) {
        await this.fail(state, key, { kind: 'spawn', message: (error as Error).message });
        return null;
      }
    }
    const resolved = await this.withServers(state, key, attempt.runtime, specialist, settings);
    if (resolved === null) return null;
    return { state, group, attempt, key, runtime, worktree, specialist: resolved, attachments };
  }

  /** The specialist ready to start (servers expanded, connections checked); null when refused. */
  private async withServers(
    state: RunState,
    key: AttemptKey,
    runtimeName: string,
    specialist: Specialist,
    settings: Readonly<Record<string, { env: Readonly<Record<string, string>> }>>,
  ): Promise<Specialist | null> {
    const variables = { ...this.dependencies.environment, ...settings[runtimeName]?.env };
    const result = connectedSpecialist(
      this.dependencies.remoteMcp,
      state.run.repository,
      specialist,
      variables,
    );
    if ('specialist' in result) return result.specialist;
    await this.fail(state, key, { kind: 'spawn', message: result.error });
    return null;
  }

  /** The token of an attempt stops being valid; so does whatever was kept open for it. */
  private release(token: string): void {
    this.parts.running.dropToken(token);
    this.dependencies.remoteMcp.attemptEnded(token);
  }

  private launch(
    prepared: Prepared,
    directory: string,
    token: string,
    skillsDirectory: string | null,
    lessons: boolean,
  ): SupervisedProcess {
    const { state, group, attempt, key, runtime, worktree, specialist } = prepared;
    const { context, entry, socket, environment, graceMs, timings } = this.dependencies;
    const launch = runtime.buildLaunch({
      specialist: effectiveSpecialist(withBridges(specialist, entry, token, socket), attempt),
      input: attempt.input,
      worktree,
      environment,
      attemptDirectory: directory,
      attachmentsDirectory: prepared.attachments,
      skillsDirectory,
      lessonsSkill: lessons ? LESSON_SKILL_NAME : null,
      workerCommand: workerCommand(entry, token, socket, group, specialist),
      generation: attempt.generation,
      conversationDirectory: conversationFolder(state, group.slug, attempt),
      sessionId: randomUUID(),
      resumeSession: attempt.resumeSession,
      claudeEditMode: state.run.config.claude.editMode,
      claudeMcp: state.run.config.claude.mcp,
      claudeSettings: state.run.config.claude.settings,
      opencodeMcp: state.run.config.opencode?.mcp ?? 'inherit',
      agyMcp: state.run.config.agy?.mcp ?? 'isolated',
      overrides: {
        claude: state.run.config.claude.overrides ?? {},
        opencode: state.run.config.opencode?.overrides ?? {},
        agy: state.run.config.agy?.overrides ?? {},
      },
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
      onLog: () => this.dependencies.publish.logGrew(key),
    });
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
          : exit.outcome.conversationError
            ? { kind: 'spawn', message: exit.outcome.conversationError }
            : exit.outcome.usageLimit
              ? { kind: 'usage_limit', resetsAt: exit.outcome.usageLimit.resetsAt }
              : network !== null
                ? { kind: 'network', problem: network }
                : null,
        outsideChanges,
        denials: exit.outcome.denials,
        onLimit: this.dependencies.queue.onLimitOf(state.run.repository),
        reply: exit.outcome.reply ?? null,
      },
    });
    purgeConversations(state, group.slug, key.seq);
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
