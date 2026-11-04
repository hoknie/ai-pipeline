import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  ConfigLoadError,
  configPaths,
  findSpecialist,
  loadRuntimeSettings,
  type RuntimeSettings,
} from '../config/index.ts';
import {
  RESOLVE_GROUP,
  SPLIT_GROUP,
  findGroup,
  isResolveGroup,
  groupRef,
  runRef,
  isServiceGroup,
  deliveryBranch,
  type DeliveryResult,
  type Attempt,
  type Effect,
  type Group,
  type MergeOutcome,
  type RunState,
  type Usage,
} from '../core/index.ts';
import {
  RUN_WORKTREE,
  attemptDirectory,
  changedFiles,
  changedPaths,
  hashFiles,
  under,
  cleanRun,
  commitAll,
  commitResolve,
  deliver,
  filesWithMarkers,
  git,
  prepareResolve,
  commitMessage,
  ensureWorktree,
  mergeBranch,
  runWorktreeRoot,
  snapshotWorkingCopy,
  updateFromBranch,
  workspaceRoot,
  type GroupChange,
  type Snapshot,
} from '../git/index.ts';
import {
  answerText,
  findExecutable,
  missingSkills,
  namingPrompt,
  parseNaming,
  runtimeFor,
} from '../runtime/index.ts';

import type { Daemon, DaemonTimings } from './daemon.ts';
import type { AgentRoot } from './processes.ts';
import { launchProcess, type SupervisedProcess } from './supervisor.ts';

export interface AttemptKey {
  run: string;
  group: string;
  seq: number;
}

interface Running {
  process: SupervisedProcess;
  timer: NodeJS.Timeout;
}

interface Baseline {
  repository: string;
  exclude: string[];
  snapshot: Snapshot;
  /** Content of paths aip itself wrote into the working copy while the attempt ran. */
  overrides: Map<string, string>;
}

export const NAMING_TIMEOUT_MS = 60_000;
/** The live usage of a run reaches its state at most once per interval. */
export const USAGE_INTERVAL_MS = 1_000;

interface UsageBuffer {
  state: RunState;
  pending: Map<string, { group: string; seq: number; usage: Usage }>;
  timer: NodeJS.Timeout | null;
}

function deliveredPaths(result: DeliveryResult): string[] {
  return result.kind === 'applied' ? [...new Set([...result.files, ...result.conflicts])] : [];
}

function keyOf(key: AttemptKey): string {
  return `${key.run}/${key.group}/${key.seq}`;
}

export class Executor {
  private readonly daemon: Daemon;
  private readonly entry: string[];
  private readonly graceMs: number | undefined;
  private readonly timings: DaemonTimings;
  private readonly tokens = new Map<string, AttemptKey>();
  private readonly running = new Map<string, Running>();
  private readonly keys = new Map<string, AttemptKey>();
  private readonly naming = new Map<SupervisedProcess, string>();
  /** Working copy of the repository as it was when each running attempt started. */
  private readonly baselines = new Map<string, Baseline>();
  /** Live usage of running attempts waiting for the next flush, by run. */
  private readonly usageBuffers = new Map<string, UsageBuffer>();

  constructor(options: {
    daemon: Daemon;
    entry: string[];
    graceMs: number | undefined;
    timings: DaemonTimings;
  }) {
    this.daemon = options.daemon;
    this.entry = options.entry;
    this.graceMs = options.graceMs;
    this.timings = options.timings;
  }

  /** Agents that run now: running attempts and the naming of runs. */
  agentRoots(): AgentRoot[] {
    const roots: AgentRoot[] = [];
    for (const [id, running] of this.running) {
      const pid = running.process.pid;
      if (pid === undefined) continue;
      const key = this.keys.get(id);
      if (key) roots.push({ pid, run: key.run, group: key.group, seq: key.seq });
    }
    for (const [process, run] of this.naming) {
      if (process.pid !== undefined) roots.push({ pid: process.pid, run, group: null, seq: null });
    }
    return roots;
  }

  attemptFor(token: string): AttemptKey | undefined {
    return this.tokens.get(token);
  }

  workspace(state: RunState): string {
    return workspaceRoot(state.run.repository, state.run.config.workspaceDir);
  }

  worktreePath(state: RunState, group: Group): string {
    const name = isResolveGroup(group)
      ? RESOLVE_GROUP
      : isServiceGroup(group)
        ? RUN_WORKTREE
        : group.slug;
    return join(runWorktreeRoot(this.workspace(state), state.run.id), name);
  }

  logPath(state: RunState, group: string, seq: number): string {
    return join(attemptDirectory(this.workspace(state), state.run.id, group, seq), 'output.log');
  }

  /** A specialist or the naming of a run is running. */
  busy(): boolean {
    return this.running.size > 0 || this.naming.size > 0;
  }

  private reportUsage(state: RunState, key: AttemptKey, usage: Usage): void {
    if (this.daemon.stopping) return;
    let buffer = this.usageBuffers.get(key.run);
    if (!buffer) {
      buffer = { state, pending: new Map(), timer: null };
      this.usageBuffers.set(key.run, buffer);
    }
    buffer.pending.set(keyOf(key), { group: key.group, seq: key.seq, usage });
    // Leading edge: with no timer running the value goes at once; the timer holds back the rest.
    if (buffer.timer === null) this.flushUsage(key.run);
  }

  private flushUsage(run: string): void {
    const buffer = this.usageBuffers.get(run);
    if (!buffer) return;
    if (buffer.timer !== null) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    if (buffer.pending.size === 0) {
      this.usageBuffers.delete(run);
      return;
    }
    const updates = [...buffer.pending.values()];
    buffer.pending.clear();
    buffer.timer = setTimeout(() => this.flushUsage(run), this.timings.usageIntervalMs);
    buffer.timer.unref();
    void this.daemon
      .serial(() => {
        if (this.daemon.stopping) return Promise.resolve();
        return this.daemon.apply(buffer.state, { kind: 'attempt_usage', updates });
      })
      .catch(() => undefined);
  }

  private dropUsage(key: AttemptKey): void {
    const buffer = this.usageBuffers.get(key.run);
    buffer?.pending.delete(keyOf(key));
  }

  async stopAll(): Promise<void> {
    for (const buffer of this.usageBuffers.values()) {
      if (buffer.timer !== null) clearTimeout(buffer.timer);
    }
    this.usageBuffers.clear();
    const exits = [...this.running.values()].map((running) => {
      clearTimeout(running.timer);
      running.process.stop();
      return running.process.exited;
    });
    for (const process of this.naming.keys()) {
      process.stop();
      exits.push(process.exited);
    }
    await Promise.allSettled(exits);
  }

  async perform(state: RunState, effects: Effect[]): Promise<void> {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'start_attempt':
          await this.start(state, effect.group, effect.seq);
          break;
        case 'stop_attempt': {
          const running = this.running.get(
            keyOf({ run: effect.run, group: effect.group, seq: effect.seq }),
          );
          if (running) {
            clearTimeout(running.timer);
            running.process.stop();
          }
          break;
        }
        case 'commit':
          await this.commit(state, effect.group, effect.stepId, effect.summary);
          break;
        case 'merge':
          await this.merge(state, effect.group, effect.updateOnConflict);
          break;
        case 'deliver':
          await this.deliver(state, effect.groups, effect.force, effect.message);
          break;
        case 'cleanup':
          await this.cleanup(state);
          break;
        case 'prepare_resolve':
          await this.prepareResolve(state, effect.groups);
          break;
        case 'finish_resolve':
          await this.finishResolve(state, effect.message, effect.conflicts);
          break;
      }
    }
  }

  /** Asks a cheap model for the title and the name of a run, in the background. */
  async nameRun(state: RunState): Promise<void> {
    const { naming } = state.run.config;
    const settings = this.runtimeSettings(state);
    if (typeof settings === 'string') return;
    const runtime = runtimeFor(naming.runtime, this.daemon.environment, settings);
    if (!findExecutable(runtime.executable, this.daemon.environment.PATH)) return;
    const directory = join(this.workspace(state), 'logs', state.run.id, '_naming');
    const logPath = join(directory, 'output.log');
    const task = state.split?.task ?? state.groups.map((group) => group.task).join('\n\n');
    const launch = runtime.buildOneShot({
      prompt: namingPrompt(task),
      model: naming.model,
      directory,
    });
    mkdirSync(directory, { recursive: true });
    const process = launchProcess(launch, {
      cwd: directory,
      logPath,
      parser: runtime.createParser(),
      environment: this.daemon.environment,
      graceMs: this.graceMs,
      drainMs: this.timings.drainMs,
    });
    this.naming.set(process, state.run.id);
    const timer = setTimeout(() => process.stop(), this.timings.namingTimeoutMs);
    const exit = await process.exited;
    clearTimeout(timer);
    this.naming.delete(process);
    if (process.pid !== undefined) {
      this.daemon.agentGone({ pid: process.pid, run: state.run.id, group: null, seq: null });
    }
    if (this.daemon.stopping) return;
    let lines: string[] = [];
    try {
      lines = readFileSync(logPath, 'utf8').split('\n');
    } catch {
      // no output
    }
    const named = exit.code === 0 ? parseNaming(answerText(runtime.transcript(lines))) : null;
    await this.daemon.serial(() =>
      this.daemon.apply(state, {
        kind: 'run_named',
        title: named?.title ?? null,
        name: named?.name ?? null,
        usage: exit.outcome.usage,
      }),
    );
  }

  private async ensureGroupWorktree(state: RunState, group: Group): Promise<string> {
    const { repository } = state.run;
    const branch = runRef(state.run);
    const runTree = await ensureWorktree(
      repository,
      join(runWorktreeRoot(this.workspace(state), state.run.id), RUN_WORKTREE),
      branch,
      null,
    );
    if (isResolveGroup(group)) return this.worktreePath(state, group);
    if (isServiceGroup(group)) return runTree;
    return ensureWorktree(
      repository,
      this.worktreePath(state, group),
      groupRef(state.run, group.slug),
      branch,
    );
  }

  /** Current `runtimes` of the shared settings.yaml, or the text of the error in it. */
  private runtimeSettings(state: RunState): RuntimeSettings | string {
    const { XDG_CONFIG_HOME, HOME } = this.daemon.environment;
    try {
      return loadRuntimeSettings(configPaths(state.run.repository, XDG_CONFIG_HOME, HOME));
    } catch (error) {
      if (!(error instanceof ConfigLoadError)) throw error;
      return `invalid swarm.runtimes: ${error.message}`;
    }
  }

  private async start(state: RunState, slug: string, seq: number): Promise<void> {
    const group = findGroup(state, slug);
    const attempt = group?.attempts.find((candidate) => candidate.seq === seq);
    if (!group || !attempt) return;
    const key = { run: state.run.id, group: slug, seq };
    const settings = this.runtimeSettings(state);
    if (typeof settings === 'string') {
      await this.exit(state, key, { kind: 'spawn', message: settings });
      return;
    }
    const runtime = runtimeFor(attempt.runtime, this.daemon.environment, settings);
    if (!findExecutable(runtime.executable, this.daemon.environment.PATH)) {
      await this.exit(state, key, { kind: 'runtime_not_found', runtime: attempt.runtime });
      return;
    }
    let worktree: string;
    try {
      worktree = await this.ensureGroupWorktree(state, group);
    } catch (error) {
      await this.exit(state, key, { kind: 'git', message: (error as Error).message });
      return;
    }
    const specialist = findSpecialist(state.run.config, attempt.specialist);
    if (!specialist) return;
    const directory = attemptDirectory(this.workspace(state), state.run.id, slug, seq);
    const logPath = this.logPath(state, slug, seq);
    mkdirSync(directory, { recursive: true });
    for (const skill of missingSkills(
      specialist.skills,
      runtime.skillDirectories(worktree, homedir()),
    )) {
      appendFileSync(logPath, `[aip] warning: skill not found: ${skill}\n`);
    }
    const token = randomUUID();
    this.tokens.set(token, key);
    const exclude = this.excluded(state);
    const before = await this.snapshot(state, exclude);
    if (before) {
      this.baselines.set(keyOf(key), {
        repository: state.run.repository,
        exclude,
        snapshot: before,
        overrides: new Map(),
      });
    }
    const launch = runtime.buildLaunch({
      specialist,
      input: attempt.input,
      worktree,
      attemptDirectory: directory,
      workerCommand: [
        ...this.entry,
        'mcp',
        '--worker',
        token,
        '--socket',
        this.daemon.socket,
        ...(slug === SPLIT_GROUP ? ['--split'] : []),
        ...(specialist.queue === true ? ['--queue'] : []),
      ],
      sessionId: randomUUID(),
      resumeSession: attempt.resumeSession,
      claudeEditMode: state.run.config.claude.editMode,
      claudeMcp: state.run.config.claude.mcp,
      claudeSettings: state.run.config.claude.settings,
    });
    if (launch.sessionId) attempt.sessionId = launch.sessionId;
    this.daemon.save(state);
    const process = launchProcess(launch, {
      cwd: worktree,
      logPath,
      parser: runtime.createParser(),
      environment: this.daemon.environment,
      graceMs: this.graceMs,
      drainMs: this.timings.drainMs,
      onUsage: (usage) => this.reportUsage(state, key, usage),
    });
    const timer = setTimeout(() => {
      if (this.daemon.stopping) return;
      void this.daemon.serial(() =>
        this.daemon.apply(state, { kind: 'timed_out', group: slug, seq }),
      );
    }, specialist.timeoutSeconds * this.timings.timeoutUnitMs);
    this.running.set(keyOf(key), { process, timer });
    this.keys.set(keyOf(key), key);
    void process.exited.then((exit) => {
      clearTimeout(timer);
      this.dropUsage(key);
      this.running.delete(keyOf(key));
      this.keys.delete(keyOf(key));
      if (process.pid !== undefined) {
        this.daemon.agentGone({ pid: process.pid, run: key.run, group: key.group, seq: key.seq });
      }
      this.tokens.delete(token);
      if (this.daemon.stopping) return undefined;
      return this.daemon.serial(async () => {
        const baseline = this.baselines.get(keyOf(key));
        this.baselines.delete(keyOf(key));
        const after = baseline ? await this.snapshot(state, baseline.exclude) : null;
        let outsideChanges: string[] = [];
        if (baseline && after) {
          try {
            outsideChanges = await changedPaths(
              baseline.repository,
              baseline.snapshot,
              after,
              baseline.overrides,
            );
          } catch {
            outsideChanges = [];
          }
        }
        await this.daemon.apply(state, {
          kind: 'attempt_exited',
          group: slug,
          seq,
          exit: {
            sessionId: exit.outcome.sessionId,
            usage: exit.outcome.usage,
            failure: exit.spawnError
              ? { kind: 'spawn', message: exit.spawnError }
              : exit.outcome.usageLimit
                ? { kind: 'usage_limit', resetsAt: exit.outcome.usageLimit.resetsAt }
                : null,
            outsideChanges,
            denials: exit.outcome.denials,
            onLimit: this.daemon.onLimitOf(state.run.repository),
          },
        });
      });
    });
  }

  /** The directory of the working copies, when it lies inside the repository. */
  private excluded(state: RunState): string[] {
    const path = relative(state.run.repository, this.workspace(state));
    if (path === '' || path.startsWith('..') || isAbsolute(path)) return [];
    return [path.split(sep).join('/')];
  }

  private async snapshot(state: RunState, exclude: string[]): Promise<Snapshot | null> {
    if (state.run.config.outsideChanges === 'off') return null;
    try {
      return await snapshotWorkingCopy(state.run.repository, { exclude });
    } catch {
      return null;
    }
  }

  /** Accepts what a delivery wrote into the working copy: it is not a change from outside. */
  private async rebaseOutside(state: RunState, result: DeliveryResult): Promise<void> {
    // The branch mode does not touch the working copy: nothing was written there.
    if (state.run.config.delivery.mode === 'branch') return;
    const repository = state.run.repository;
    const paths = deliveredPaths(result);
    const baselines = [...this.baselines.values()].filter(
      (baseline) => baseline.repository === repository,
    );
    if (baselines.length === 0 || paths.length === 0) return;
    try {
      const current = await hashFiles(repository, paths);
      for (const baseline of baselines) {
        for (const [path, hash] of current) {
          if (!under(path, baseline.exclude)) baseline.overrides.set(path, hash);
        }
      }
    } catch {
      // Without the content the paths stay as they are: at worst a warning is shown.
    }
  }

  private async exit(
    state: RunState,
    key: AttemptKey,
    failure: NonNullable<Attempt['reason']>,
  ): Promise<void> {
    this.baselines.delete(keyOf(key));
    await this.daemon.apply(state, {
      kind: 'attempt_exited',
      group: key.group,
      seq: key.seq,
      exit: { sessionId: null, usage: null, failure, outsideChanges: [] },
    });
  }

  private async commit(
    state: RunState,
    slug: string,
    stepId: string,
    summary: string,
  ): Promise<void> {
    const group = findGroup(state, slug);
    if (!group) return;
    try {
      await commitAll(
        this.worktreePath(state, group),
        commitMessage(slug, stepId, summary),
        groupRef(state.run, slug),
        state.run.config.workspace.include,
      );
      void this.daemon.refreshDiff(state, slug);
    } catch (error) {
      await this.daemon.apply(state, {
        kind: 'commit_failed',
        group: slug,
        message: (error as Error).message,
      });
    }
  }

  private async merge(state: RunState, slug: string, updateOnConflict: boolean): Promise<void> {
    const group = findGroup(state, slug);
    if (!group) return;
    let outcome: MergeOutcome;
    try {
      const runTree = await this.ensureGroupWorktree(state, { ...group, slug: SPLIT_GROUP });
      const source = groupRef(state.run, slug);
      const target = runRef(state.run);
      const message = `aip: merge ${slug}`;
      const first = await mergeBranch(runTree, source, message, target);
      if (first.kind === 'merged') outcome = first;
      else if (!updateOnConflict) outcome = first;
      else {
        const updated = await updateFromBranch(this.worktreePath(state, group), target, source);
        if (updated.kind === 'conflict')
          outcome = { kind: 'conflict_updated', files: updated.files };
        else outcome = await mergeBranch(runTree, source, message, target);
      }
    } catch (error) {
      outcome = { kind: 'failed', message: (error as Error).message };
    }
    await this.daemon.apply(state, { kind: 'merge_finished', group: slug, outcome });
    void this.daemon.refreshDiff(state, slug);
  }

  async changedFiles(state: RunState, slugs: string[] | null): Promise<string[]> {
    const groups = state.groups.filter(
      (group) =>
        group.mergeCommit !== null &&
        group.status === 'merged' &&
        (slugs === null || slugs.length === 0
          ? group.delivery.state !== 'applied'
          : slugs.includes(group.slug)),
    );
    const files = await Promise.all(
      groups.map((group) =>
        changedFiles(state.run.repository, `${group.mergeCommit}^1`, group.mergeCommit as string),
      ),
    );
    return [...new Set(files.flat())].sort();
  }

  private groupChanges(state: RunState, slugs: string[]): GroupChange[] {
    return state.groups
      .filter((group) => slugs.includes(group.slug) && group.mergeCommit !== null)
      .sort((left, right) => (left.mergeSeq ?? 0) - (right.mergeSeq ?? 0))
      .map((group) => ({
        group: group.slug,
        from: `${group.mergeCommit}^1`,
        to: group.mergeCommit as string,
      }));
  }

  private resolveBaseRef(state: RunState): string {
    return `refs/aip/${state.run.id}/resolve-base`;
  }

  private resolveWorktree(state: RunState): string {
    return join(runWorktreeRoot(this.workspace(state), state.run.id), RESOLVE_GROUP);
  }

  private async prepareResolve(state: RunState, slugs: string[]): Promise<void> {
    try {
      const prepared = await prepareResolve({
        repository: state.run.repository,
        worktree: this.resolveWorktree(state),
        changes: this.groupChanges(state, slugs),
        include: state.run.config.workspace.include,
        baseRef: this.resolveBaseRef(state),
      });
      await this.daemon.apply(state, { kind: 'resolve_prepared', conflicts: prepared.conflicts });
    } catch (error) {
      const message = `could not prepare the resolver: ${(error as Error).message}`;
      await this.daemon.apply(state, {
        kind: 'delivery_finished',
        result: { kind: 'failed', message },
      });
    }
  }

  private async finishResolve(
    state: RunState,
    message: string,
    conflicts: string[],
  ): Promise<void> {
    let result: DeliveryResult;
    try {
      const worktree = this.resolveWorktree(state);
      const left = filesWithMarkers(worktree, conflicts);
      if (left.length > 0) {
        result = { kind: 'failed', message: `conflict markers remain in: ${left.join(', ')}` };
      } else {
        const { repository } = state.run;
        const { include } = state.run.config.workspace;
        const base = await git(repository, 'rev-parse', this.resolveBaseRef(state));
        const resolved = await commitResolve(worktree, base, include);
        result = await deliver({
          repository,
          changes: [{ group: RESOLVE_GROUP, from: base, to: resolved }],
          mode: state.run.config.delivery.mode,
          force: false,
          message,
          branch: deliveryBranch(state.run),
          runRef: runRef(state.run),
          include,
        });
      }
    } catch (error) {
      result = { kind: 'failed', message: (error as Error).message };
    }
    await this.rebaseOutside(state, result);
    await this.daemon.apply(state, { kind: 'delivery_finished', result });
  }

  private async deliver(
    state: RunState,
    slugs: string[],
    force: boolean,
    message: string,
  ): Promise<void> {
    let result: DeliveryResult;
    try {
      const changes = this.groupChanges(state, slugs);
      result = await deliver({
        repository: state.run.repository,
        changes,
        mode: state.run.config.delivery.mode,
        force,
        message,
        branch: deliveryBranch(state.run),
        runRef: runRef(state.run),
        include: state.run.config.workspace.include,
      });
    } catch (error) {
      result = { kind: 'failed', message: (error as Error).message };
    }
    await this.rebaseOutside(state, result);
    await this.daemon.apply(state, { kind: 'delivery_finished', result });
  }

  private async cleanup(state: RunState): Promise<void> {
    try {
      await cleanRun({
        repository: state.run.repository,
        root: runWorktreeRoot(this.workspace(state), state.run.id),
        runBranch: deliveryBranch(state.run),
        groupBranches: [],
        refPrefix: `refs/aip/${state.run.id}/`,
        all: false,
        active: false,
      });
    } catch {
      return;
    }
  }
}
