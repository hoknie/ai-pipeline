import {
  type Queue,
  type QueueItem,
  DEFAULT_AUTOPILOT_ANSWER,
  canReturn,
  dependencyState,
  freezeCandidate,
  itemReadiness,
  occupiesSlot,
} from '../../../feature/queue/types/index.ts';
import { stepProgress, summarize } from '../../../feature/runs/services/index.ts';
import {
  type Group,
  type GroupWait,
  type RunState,
  allGroups,
  attemptStepLabel,
  isRunFinished,
  isTerminal,
  runProblems,
  runTitle,
  stepLabel,
  stepsOf,
} from '../../../feature/runs/types/index.ts';
import { type DeliveryMode, pipelineNameOf } from '../../../feature/swarm-config/types/index.ts';
import type { Tag } from '../../../feature/tags/types/index.ts';
import type {
  DependencyView,
  QueueItemView,
  QueueRunView,
  QueueView,
} from '../contract/responses/queue.ts';
import type { WaitLookup } from '../contract/responses/runs.ts';
import {
  NO_WAITS,
  displayStatus,
  groupHold,
  groupLimitUntil,
  serviceStatus,
  systemGroups,
} from './rows.ts';
import { deliveryStage } from './runs.ts';
import { tagViews } from './tags.ts';

/** Card of a run of the queue; `stopping`: the problem shown is the one that stops a queue. */
function queueRunView(
  queue: Queue,
  state: RunState,
  catalog: readonly Tag[],
  stopping: boolean,
  waits: WaitLookup,
): QueueRunView {
  const waitOf = (group: Group): GroupWait | null =>
    group.status === 'queued' ? waits(state.run.id, group.slug) : null;
  const problems = runProblems(state);
  const problem =
    (stopping ? problems.find((p) => p.reason !== 'needs_human') : undefined) ?? problems[0];
  return {
    id: state.run.id,
    returnable: canReturn(queue, state),
    priority: queue.priority.includes(state.run.id),
    number: state.run.number,
    title: runTitle(state),
    state: summarize(state).state,
    pipeline: state.run.pipeline,
    pipelineName: pipelineNameOf(state.run.config, state.run.pipeline),
    tags: tagViews(catalog, state.run.tags),
    createdAt: state.run.createdAt,
    groups: {
      done: state.groups.filter((group) => isTerminal(group.status)).length,
      total: state.groups.length,
    },
    steps: stepProgress(state),
    system: systemGroups(state).map(({ kind, group }) => ({
      kind,
      status: displayStatus(serviceStatus(group), waitOf(group), groupHold(state, group)),
      ...(kind === 'action' ? { title: group.title } : {}),
    })),
    delivery: deliveryStage(state)?.status ?? null,
    waiting: allGroups(state).flatMap((group) => {
      const wait = waitOf(group);
      if (wait === null) return [];
      const index = group.pending?.stepIndex;
      const steps = stepsOf(state.run, group);
      const found = index === undefined ? undefined : steps[index];
      return [
        {
          group: group.slug,
          step: found?.id ?? null,
          stepName: found ? stepLabel(state.run.config, steps, found) : null,
          wait,
        },
      ];
    }),
    active: allGroups(state)
      .filter((group) => group.status === 'running' || group.status === 'merging')
      .map((group) => {
        const last = group.attempts.at(-1);
        return {
          group: group.slug,
          step: last?.stepId ?? null,
          stepName: last ? attemptStepLabel(state, group, last) : null,
        };
      }),
    delivering: isRunFinished(state) && occupiesSlot(state),
    usage: summarize(state).usage,
    problem: problem ? { group: problem.group, reason: problem.reason } : null,
    limitUntil: allGroups(state).reduce<number | null>((latest, group) => {
      const until = groupLimitUntil(group);
      return until === null ? latest : Math.max(latest ?? 0, until);
    }, null),
  };
}

/** The task of an item; a returned run shows the task of the run. */
function itemBody(
  item: QueueItem,
  lookup: (id: string) => RunState | undefined,
): Pick<QueueItemView, 'task' | 'groups'> {
  if (item.run === null) return { task: item.task, groups: item.groups };
  const state = lookup(item.run);
  if (!state) return { task: null, groups: null };
  if (state.split) return { task: state.split.task, groups: null };
  if (state.groups.length === 1) return { task: state.groups[0]!.task, groups: null };
  return {
    task: null,
    groups: state.groups.map((group) => ({ title: group.title, task: group.task })),
  };
}

/** A predecessor of a queue item: another item of the queue, or a run. */
function dependencyView(
  queue: Queue,
  ref: string,
  lookup: (id: string) => RunState | undefined,
): DependencyView {
  const other = queue.items.find((candidate) => candidate.id === ref);
  const state = dependencyState(queue, ref, lookup);
  if (other) {
    const label = other.title ?? (other.task ? other.task.trim().split('\n')[0] : null);
    return { kind: 'item', id: ref, number: other.number, title: label ?? other.pipeline, state };
  }
  const run = lookup(ref);
  return {
    kind: 'run',
    id: ref,
    number: run ? run.run.number : null,
    title: run ? runTitle(run) : ref,
    state,
  };
}

export function queueView(
  queue: Queue,
  lookup: (id: string) => RunState | undefined,
  autoDeliver: boolean | null = null,
  catalog: readonly Tag[] = [],
  deliveryMode: DeliveryMode | null = null,
  waits: WaitLookup = NO_WAITS,
  names: (id: string) => string = (id) => id,
): QueueView {
  const cards = (ids: string[], stopping: boolean): QueueRunView[] =>
    ids.flatMap((id) => {
      const state = lookup(id);
      return state ? [queueRunView(queue, state, catalog, stopping, waits)] : [];
    });
  const runs = cards(queue.runs, false);
  const skipped = cards(queue.skipped, true);
  return {
    repository: queue.repository,
    status: queue.status,
    parallel: queue.parallel,
    autopilot: queue.autopilot,
    autoAnswer: queue.autoAnswer,
    skipFailed: queue.skipFailed,
    autoDeliver,
    deliveryMode,
    autopilotAnswer: queue.autopilotAnswer,
    autopilotAnswerDefault: DEFAULT_AUTOPILOT_ANSWER,
    onLimit: queue.onLimit,
    stop: queue.stop,
    freezeCandidate:
      queue.runs.length >= queue.parallel
        ? freezeCandidate(
            queue,
            queue.runs.flatMap((id) => lookup(id) ?? []),
            null,
          )
        : null,
    items: queue.items.map((item, index) => ({
      id: item.id,
      number: item.number,
      position: index + 1,
      pipeline: item.pipeline,
      pipelineName: names(item.pipeline),
      ...itemBody(item, lookup),
      title: item.title,
      autoDeliver: item.autoDeliver,
      deliveryMode: item.deliveryMode,
      tags: tagViews(catalog, item.tags),
      skip: [...(item.run === null ? item.skip : (lookup(item.run)?.run.skippedSteps ?? []))],
      readiness: itemReadiness(queue, item, lookup),
      after: item.after.map((ref) => dependencyView(queue, ref, lookup)),
      postponed: item.postponed,
      createdAt: item.createdAt,
      error: item.error,
      run: item.run,
      hold: (item.run === null ? undefined : lookup(item.run)?.run.hold) ?? null,
    })),
    runs,
    skipped,
    updatedAt: queue.updatedAt,
  };
}
