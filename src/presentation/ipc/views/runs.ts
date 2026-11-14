import {
  type RepairPolicy,
  defaultObserverSettings,
  repairPolicy,
} from '../../../feature/observers/types/index.ts';
import {
  runStartedAt,
  specialistUse,
  stepProgress,
  summarize,
} from '../../../feature/runs/services/index.ts';
import {
  type Group,
  type GroupWait,
  type Topology,
  type RunState,
  GROUP_STATUSES,
  allGroups,
  deliveryCounts,
  findGroup,
  isServiceGroup,
  runTitle,
  stepStates,
  topology,
} from '../../../feature/runs/types/index.ts';
import { pipelineNameOf, variantNameOf } from '../../../feature/swarm-config/types/index.ts';
import type { Tag } from '../../../feature/tags/types/index.ts';
import type {
  ArtifactCounts,
  DeliveryStage,
  DiffLookup,
  DiffStat,
  DiffTotals,
  RunRepairView,
  RunView,
  WaitLookup,
} from '../contract/responses/runs.ts';
import {
  NO_ARTIFACTS,
  NO_DIFFS,
  NO_WAITS,
  displayStatus,
  groupHold,
  groupRow,
  isHold,
  serviceStatus,
  systemGroups,
  systemRow,
} from './rows.ts';
import {
  resolverRow,
  splitRow,
  stageStatuses,
  waitingTopology,
  type WaitOf,
} from './run-stages.ts';
import { tagViews } from './tags.ts';

/**
 * When the clock of a held run stops: the end of its last attempt, once nothing runs, merges
 * or delivers. Null while the run is not held, is finished, still works or has no attempt.
 */
export function clockStoppedAt(state: RunState): number | null {
  if (state.run.hold === null || state.run.finishedAt !== null) return null;
  if (state.run.pendingDelivery !== null) return null;
  const groups = allGroups(state);
  if (groups.some((group) => group.status === 'merging')) return null;
  const attempts = groups.flatMap((group) => group.attempts);
  if (attempts.length === 0 || attempts.some((attempt) => attempt.status === 'running')) {
    return null;
  }
  const ends = attempts
    .map((attempt) => attempt.finishedAt)
    .filter((time): time is number => time !== null);
  return ends.length > 0 ? Math.max(...ends) : null;
}

function lastDeliveryAt(state: RunState): number | null {
  const times = state.groups
    .filter((group) => group.status === 'merged')
    .map((group) => group.delivery.finishedAt)
    .filter((time): time is number => time !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

/** Delivery as a system stage, by the merged groups and the delivery in progress. */
export function deliveryStage(state: RunState): DeliveryStage | null {
  const counts = deliveryCounts(state);
  if (state.run.pendingDelivery !== null) return { status: 'delivering' };
  if (counts.merged === 0) return null;
  const failed = state.groups.filter(
    (group) => group.status === 'merged' && group.delivery.state === 'apply_failed',
  );
  if (failed.length > 0) {
    return {
      status: 'apply_failed',
      reason: failed[0]?.delivery.reason ?? null,
      groups: failed.map((group) => group.slug),
    };
  }
  if (counts.applied !== counts.merged) return { status: 'pending' };
  return {
    status: 'applied',
    manual: state.groups.some((group) => group.status === 'merged' && group.delivery.manual),
  };
}

/** Status counts with the groups held back by the scheduler moved from `queued` to `waiting`. */
function countsLine(state: RunState, waiting: number): string {
  const summary = summarize(state);
  const counts: Record<string, number> = { ...summary.counts };
  const hold = state.run.hold;
  const held =
    hold === null
      ? 0
      : allGroups(state).filter(
          (group) => group.status === 'queued' && groupHold(state, group) !== null,
        ).length;
  counts['queued'] = (counts['queued'] ?? 0) - waiting - held;
  counts['waiting'] = waiting;
  if (hold !== null) counts[hold] = held;
  const order = GROUP_STATUSES.flatMap((status) =>
    status === 'queued' ? ['queued', 'waiting', 'frozen', 'paused'] : [status],
  );
  return order
    .filter((status) => (counts[status] ?? 0) > 0)
    .map((status) => `${status} ${counts[status]}`)
    .join(' · ');
}

function runDiff(state: RunState, diffs: DiffLookup): DiffTotals | null {
  const merged = state.groups
    .filter((group) => group.status === 'merged')
    .map((group) => diffs(group.slug));
  if (merged.length === 0 || merged.some((diff) => diff === null)) return null;
  const files = new Set(merged.flatMap((diff) => diff?.files.map((file) => file.path) ?? []));
  return {
    files: files.size,
    added: merged.reduce((sum, diff) => sum + (diff?.added ?? 0), 0),
    removed: merged.reduce((sum, diff) => sum + (diff?.removed ?? 0), 0),
  };
}

function runLiveDiff(state: RunState, diffs: DiffLookup): DiffTotals | null {
  const stats = state.groups
    .filter((group) => !isServiceGroup(group) && group.status !== 'cancelled')
    .map((group) => diffs(group.slug))
    .filter((diff): diff is DiffStat => diff !== null);
  if (stats.length === 0) return null;
  const files = new Set(stats.flatMap((diff) => diff.files.map((file) => file.path)));
  return {
    files: files.size,
    added: stats.reduce((sum, diff) => sum + diff.added, 0),
    removed: stats.reduce((sum, diff) => sum + diff.removed, 0),
  };
}

/** Marks the view with its return item; a finished run with one shows as `queued`. */
export function withQueue(view: RunView, item: string | null): RunView {
  if (item === null) return view;
  const state =
    view.hold !== null || view.state === 'repair'
      ? view.state
      : view.finished
        ? 'queued'
        : view.state;
  return { ...view, queueItem: item, state };
}

function runProgress(state: RunState): { done: number; total: number } {
  const { done, total } = stepProgress(state);
  return { done, total };
}

/** The incident being repaired, or a waiting one an observer may take; the run has no hold. */
export function repairActive(state: RunState, observers: RepairPolicy): boolean {
  if (state.run.hold !== null) return false;
  return state.run.repair.incident !== null || observers.takesIncident(state);
}

function repairView(state: RunState, observers: RepairPolicy): RunRepairView {
  const { repair } = state.run;
  return {
    allowed: repair.allowed,
    active: repairActive(state, observers),
    repairs: repair.repairs,
    incident: repair.incident,
    cancelReason: repair.cancelReason,
  };
}

/** The identity, state and timing of the run. */
function runHead(state: RunState, observers: RepairPolicy) {
  const summary = summarize(state);
  return {
    id: state.run.id,
    number: state.run.number,
    title: runTitle(state),
    name: state.run.name ?? null,
    repository: state.run.repository,
    pipeline: state.run.pipeline,
    pipelineName: pipelineNameOf(state.run.config, state.run.pipeline),
    variant: state.run.variant,
    variantName: variantNameOf(state.run.config, state.run.pipeline, state.run.variant),
    branch: state.run.branch,
    createdAt: state.run.createdAt,
    startedAt: runStartedAt(state),
    finishedAt: state.run.finishedAt,
    finished: summary.finished,
    state: repairActive(state, observers)
      ? ('repair' as const)
      : state.run.hold !== null && summary.state !== 'needs_human'
        ? state.run.hold
        : summary.state,
    hold: state.run.hold,
    clockStoppedAt: clockStoppedAt(state),
    waiting: summary.waiting,
    dirtyWarning: state.run.dirtyWarning,
    autoDeliver: state.run.config.delivery.auto,
    deliveryMode: state.run.config.delivery.mode,
    fromQueue: state.run.fromQueue,
    returnable: false,
    // The queue is unknown here: the daemon fills it in with `withQueue`.
    queueItem: null,
  };
}

export function runView(
  state: RunState,
  now: number,
  diffs: DiffLookup = NO_DIFFS,
  catalog: readonly Tag[] = [],
  waits: WaitLookup = NO_WAITS,
  artifacts: ArtifactCounts = NO_ARTIFACTS,
  observers: RepairPolicy = repairPolicy(defaultObserverSettings()),
): RunView {
  const summary = summarize(state);
  const waitOf: WaitOf = (group) =>
    group.status === 'queued' && groupHold(state, group) === null
      ? waits(state.run.id, group.slug)
      : null;
  const waitingGroups = state.groups.filter((group) => waitOf(group) !== null).length;
  const stages = stageStatuses(state, waitOf);
  return {
    ...runHead(state, observers),
    tags: tagViews(catalog, state.run.tags),
    counts: countsLine(state, waitingGroups),
    total: summary.total,
    usage: summary.usage,
    split: splitRow(state, stages, waitOf),
    delivery: {
      ...deliveryCounts(state),
      inProgress: state.run.pendingDelivery !== null,
      finishedAt: lastDeliveryAt(state),
    },
    resolver: resolverRow(state, stages, waitOf),
    deliveryStage: deliveryStage(state),
    diff: runDiff(state, diffs),
    liveDiff: runLiveDiff(state, diffs),
    progress: runProgress(state),
    topology: waitingTopology(state, stages, waitOf),
    steps: stepStates(state),
    specialists: specialistUse(state),
    groups: state.groups.map((group) =>
      groupRow(state, group, now, diffs, waitOf(group), artifacts),
    ),
    system: systemGroups(state).map(({ kind, group }) =>
      systemRow(state, group, kind, now, waitOf(group), artifacts),
    ),
    decisions: allGroups(state).flatMap((group) =>
      group.decisions.map((decision) => ({ ...decision, group: group.slug })),
    ),
    repair: repairView(state, observers),
  };
}
