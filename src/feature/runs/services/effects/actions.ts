import { mkdirSync } from 'node:fs';

import { launchProcess } from '../../../agents/services/index.ts';
import type { OutputParser } from '../../../agents/types/index.ts';
import { timesPath } from '../../../agents/services/index.ts';
import { attemptDirectory } from '../../../../platform/git/index.ts';
import type { ActionOutcome } from '../../machine/index.ts';
import {
  actionGroupsOf,
  actionOf,
  actionPointOf,
  findGroup,
  isRepairGroup,
  parseActionSlug,
  type Group,
  type RunState,
} from '../../types/index.ts';

import type { EffectDependencies } from './context.ts';
import type { RunningAgents } from './running.ts';
import { ensureGroupWorktree, logPath, resetRunTree, workspaceOf } from './worktrees.ts';

/** The output of a command is only logged: it has no usage, session or denials. */
const QUIET: OutputParser = {
  push() {},
  usage: () => null,
  outcome: () => ({ sessionId: null, usage: null, error: null, denials: [] }),
};

/**
 * The scripts of a command run one after another in one shell process, each in its own `sh -c`:
 * the first failure stops the action with its code. The scripts are arguments, never part of this
 * text, so quotes and `$` in them need no escaping.
 */
const SCRIPT_LOOP =
  'for script in "$@"; do printf \'[aip] $ %s\\n\' "$script"; /bin/sh -c "$script" || exit $?; done';

/** The environment of a command action. */
function actionEnvironment(state: RunState, group: Group): Record<string, string> {
  const ref = parseActionSlug(group.slug);
  const { run } = state;
  const environment: Record<string, string> = {
    AIP_RUN_ID: run.id,
    AIP_RUN_TITLE: run.title ?? '',
    AIP_PIPELINE: run.pipeline,
    // The name before the term was unified; scripts in user repositories still read it.
    AIP_WORKFLOW: run.pipeline,
    AIP_STAGE: ref?.point ?? '',
    AIP_ACTION: ref?.id ?? '',
    AIP_REPOSITORY: run.repository,
  };
  if (ref?.point === 'after_delivery') {
    const delivered = state.groups.filter(
      (candidate) => candidate.status === 'merged' && candidate.delivery.state === 'applied',
    );
    const last = [...delivered]
      .filter((candidate) => candidate.delivery.message)
      .sort((left, right) => (right.delivery.finishedAt ?? 0) - (left.delivery.finishedAt ?? 0))[0];
    environment.AIP_DELIVERY_MODE = run.config.delivery.mode;
    environment.AIP_COMMIT_MESSAGE = last?.delivery.message ?? '';
    environment.AIP_CHANGED_FILES = [
      ...new Set(delivered.flatMap((candidate) => candidate.delivery.files)),
    ].join('\n');
  }
  return environment;
}

/** Where a command action runs: the tree of the run, or the repository of the user after delivery. */
async function actionDirectory(state: RunState, group: Group): Promise<string> {
  if (actionPointOf(group) === 'after_delivery') return state.run.repository;
  return ensureGroupWorktree(state, group);
}

/** The command actions of a pipeline and what their trees must not keep. */
export class ActionRunner {
  private readonly dependencies: EffectDependencies;
  private readonly running: RunningAgents;

  constructor(dependencies: EffectDependencies, running: RunningAgents) {
    this.dependencies = dependencies;
    this.running = running;
  }

  /** The command of an action before delivery must not change the result: drop what it wrote. */
  async discardChanges(state: RunState, group: Group): Promise<void> {
    // A repair works on a copy of the ref of the run: what it leaves there is dropped. The tree of
    // a delivery repair is the resolver's and is kept for the delivery.
    const repairCopy = isRepairGroup(group) && !state.run.pendingDelivery?.repair;
    if (actionPointOf(group) !== 'before_delivery' && !repairCopy) return;
    try {
      await resetRunTree(state, await ensureGroupWorktree(state, group));
    } catch {
      // The tree may be gone with a cleaned run; there is nothing to drop then.
    }
  }

  /**
   * A merge goes on the ref of the run, never on what a check left in the tree: a stopped check
   * may still be working there, and one cut off by a restart never dropped its changes.
   */
  async settleChecks(state: RunState, tree: string): Promise<void> {
    const checks = actionGroupsOf(state, 'before_delivery');
    if (checks.length === 0) return;
    const exits = checks.flatMap((group) =>
      group.attempts.map(
        (attempt) =>
          this.running.process({ run: state.run.id, group: group.slug, seq: attempt.seq })?.exited,
      ),
    );
    // The process itself: its exit handler waits in the same queue as this merge.
    await Promise.allSettled(exits);
    await resetRunTree(state, tree);
  }

  async run(state: RunState, slug: string, seq: number): Promise<void> {
    const group = findGroup(state, slug);
    const attempt = group?.attempts.find((candidate) => candidate.seq === seq);
    const action = group ? actionOf(state.run, group) : undefined;
    if (!group || !attempt || !action || action.run === null) return;
    const { context } = this.dependencies;
    const finish = async (outcome: ActionOutcome): Promise<void> => {
      await this.discardChanges(state, group);
      await context.apply(state, { kind: 'action_finished', group: slug, seq, outcome });
    };
    let directory: string;
    try {
      // Leftovers of an interrupted check must not reach this one.
      await this.discardChanges(state, group);
      directory = await actionDirectory(state, group);
    } catch (error) {
      await finish({ kind: 'spawn', message: (error as Error).message });
      return;
    }
    this.launch(
      state,
      group,
      seq,
      { run: action.run, timeoutSeconds: action.timeoutSeconds },
      directory,
      finish,
    );
  }

  private launch(
    state: RunState,
    group: Group,
    seq: number,
    action: { run: string[]; timeoutSeconds: number },
    directory: string,
    finish: (outcome: ActionOutcome) => Promise<void>,
  ): void {
    const { context, environment, graceMs, timings, agentExit } = this.dependencies;
    const key = { run: state.run.id, group: group.slug, seq };
    const log = logPath(state, group.slug, seq);
    mkdirSync(attemptDirectory(workspaceOf(state), state.run.id, group.slug, seq), {
      recursive: true,
    });
    const process = launchProcess(
      {
        command: '/bin/sh',
        args: ['-c', SCRIPT_LOOP, 'aip-action', ...action.run],
        env: actionEnvironment(state, group),
        files: [],
        sessionId: null,
      },
      {
        cwd: directory,
        logPath: log,
        parser: QUIET,
        environment,
        graceMs,
        drainMs: timings.drainMs,
        timesPath: timesPath(log),
      },
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      process.stop();
    }, action.timeoutSeconds * timings.timeoutUnitMs);
    this.running.add(key, process, timer);
    void process.exited.then((exit) => {
      clearTimeout(timer);
      this.running.remove(key);
      if (process.pid !== undefined) agentExit.agentGone({ pid: process.pid, ...key });
      // A stopping daemon leaves the attempt running: the next start marks it interrupted.
      if (context.stopping) return undefined;
      const outcome: ActionOutcome = exit.spawnError
        ? { kind: 'spawn', message: exit.spawnError }
        : timedOut
          ? { kind: 'timeout' }
          : { kind: 'exit', code: exit.code ?? 1 };
      return context.serial(() => finish(outcome));
    });
  }
}
