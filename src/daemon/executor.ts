import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { findSpecialist } from '../config/index.ts';
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
} from '../core/index.ts';
import {
  RUN_WORKTREE,
  attemptDirectory,
  changedFiles,
  changedPaths,
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

import type { Daemon } from './daemon.ts';
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

export const NAMING_TIMEOUT_MS = 60_000;

function keyOf(key: AttemptKey): string {
  return `${key.run}/${key.group}/${key.seq}`;
}

export class Executor {
  private readonly daemon: Daemon;
  private readonly entry: string[];
  private readonly graceMs: number | undefined;
  private readonly tokens = new Map<string, AttemptKey>();
  private readonly running = new Map<string, Running>();
  private readonly naming = new Set<SupervisedProcess>();

  constructor(options: { daemon: Daemon; entry: string[]; graceMs: number | undefined }) {
    this.daemon = options.daemon;
    this.entry = options.entry;
    this.graceMs = options.graceMs;
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

  async stopAll(): Promise<void> {
    const exits = [...this.running.values()].map((running) => {
      clearTimeout(running.timer);
      running.process.stop();
      return running.process.exited;
    });
    for (const process of this.naming) {
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
    const runtime = runtimeFor(naming.runtime, this.daemon.environment);
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
    });
    this.naming.add(process);
    const timer = setTimeout(() => process.stop(), NAMING_TIMEOUT_MS);
    const exit = await process.exited;
    clearTimeout(timer);
    this.naming.delete(process);
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

  private async start(state: RunState, slug: string, seq: number): Promise<void> {
    const group = findGroup(state, slug);
    const attempt = group?.attempts.find((candidate) => candidate.seq === seq);
    if (!group || !attempt) return;
    const key = { run: state.run.id, group: slug, seq };
    const runtime = runtimeFor(attempt.runtime, this.daemon.environment);
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
    const before = await this.snapshot(state);
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
    });
    const timer = setTimeout(() => {
      if (this.daemon.stopping) return;
      void this.daemon.serial(() =>
        this.daemon.apply(state, { kind: 'timed_out', group: slug, seq }),
      );
    }, specialist.timeoutSeconds * 1000);
    this.running.set(keyOf(key), { process, timer });
    void process.exited.then((exit) => {
      clearTimeout(timer);
      this.running.delete(keyOf(key));
      this.tokens.delete(token);
      if (this.daemon.stopping) return undefined;
      return this.daemon.serial(async () => {
        const after = before ? await this.snapshot(state) : null;
        const outsideChanges = before && after ? changedPaths(before, after) : [];
        await this.daemon.apply(state, {
          kind: 'attempt_exited',
          group: slug,
          seq,
          exit: {
            sessionId: exit.outcome.sessionId,
            usage: exit.outcome.usage,
            failure: exit.spawnError ? { kind: 'spawn', message: exit.spawnError } : null,
            outsideChanges,
            denials: exit.outcome.denials,
          },
        });
      });
    });
  }

  private async snapshot(state: RunState): Promise<Snapshot | null> {
    if (state.run.config.outsideChanges === 'off') return null;
    try {
      return await snapshotWorkingCopy(state.run.repository);
    } catch {
      return null;
    }
  }

  private async exit(
    state: RunState,
    key: AttemptKey,
    failure: NonNullable<Attempt['reason']>,
  ): Promise<void> {
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
