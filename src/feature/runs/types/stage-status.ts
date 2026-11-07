import {
  type Action,
  type ActionPoint,
  ACTION_POINTS,
  findAction,
  groupPipeline,
  pipelineActionIds,
} from '../../swarm-config/types/index.ts';
import type { GroupStatus, RunHold } from './constants.ts';
import { type Group, actionPointOf, actionSlug, freshPending, newGroup } from './group.ts';
import {
  type RunState,
  actionGroupsOf,
  isHeldByAction,
  openAction,
  pointClosed,
  runPipeline,
} from './run.ts';
import { stepStates } from './skip.ts';

/** Status of a stage in a run: the stored one, `done` for a merged service step, or `waiting`. */
export type StageStatus = GroupStatus | 'done' | 'waiting' | RunHold;

const STEP_ORDER: GroupStatus[] = ['running', 'needs_human', 'failed', 'conflict', 'queued'];

/** Status of a step among the groups of a run; null while no group reached it. */
export function stepStatus(state: RunState, stepId: string, index: number): StageStatus | null {
  const phase = stepStates(state)[index]?.state;
  if (phase === 'done') return 'done';
  if (phase !== 'active') return null;
  const steps = groupPipeline(state.run.config, runPipeline(state.run)).steps;
  const found = new Set<GroupStatus>();
  for (const group of state.groups) {
    if (group.status === 'merged' || group.status === 'cancelled') continue;
    if (group.status === 'merging' || group.status === 'conflict') continue;
    const running = group.attempts.find((attempt) => attempt.status === 'running');
    const at = running
      ? running.stepId
      : group.pending
        ? steps[group.pending.stepIndex]?.id
        : group.attempts.at(-1)?.stepId;
    if (at === stepId) found.add(group.status);
  }
  return STEP_ORDER.find((status) => found.has(status)) ?? 'done';
}

export function statusOf(group: Group | undefined): StageStatus | null {
  if (!group) return null;
  return group.status === 'merged' ? 'done' : group.status;
}

/** Status of an action: a queued one waits for its turn, the gate of the point or a hold. */
export function actionStatus(state: RunState, group: Group | undefined): StageStatus | null {
  if (!group) return null;
  if (group.status !== 'queued') return statusOf(group);
  const point = actionPointOf(group);
  // Actions around the delivery go on during a hold.
  if (state.run.hold !== null && (point === 'before_split' || point === 'after_split'))
    return state.run.hold;
  const noRequest = point === 'before_delivery' && state.run.pendingDelivery === null;
  if (noRequest || isHeldByAction(state, group) || !actionMayStart(state, group)) return 'waiting';
  return 'queued';
}

export function mergeStatus(state: RunState): StageStatus | null {
  if (state.groups.length === 0) return null;
  if (state.groups.some((group) => group.status === 'conflict')) return 'conflict';
  if (state.groups.some((group) => group.status === 'merging')) return 'merging';
  return state.groups.every((group) => group.status === 'merged') ? 'done' : null;
}

function mergedGroups(state: RunState): Group[] {
  return state.groups.filter((group) => group.status === 'merged');
}

export function deliveryStatus(state: RunState): StageStatus | null {
  const pending = state.run.pendingDelivery;
  if (pending) return pending.checks ? 'waiting' : 'running';
  const merged = mergedGroups(state);
  if (merged.length === 0) return null;
  if (merged.every((group) => group.delivery.state === 'applied')) return 'done';
  return merged.some((group) => group.delivery.state === 'apply_failed') ? 'failed' : null;
}

export function cleanupStatus(state: RunState): StageStatus | null {
  const merged = mergedGroups(state);
  const delivered =
    merged.length > 0 && merged.every((group) => group.delivery.state === 'applied');
  if (!delivered) return null;
  return pointClosed(state, 'after_delivery') ? 'done' : 'waiting';
}

/** Display name of an action: its `name`, else the id. */
export function actionName(action: Action): string {
  return action.name ?? action.id;
}

/** What the pipeline does at a point: go on, or wait for the action that is not settled yet. */
export type NextAction = { kind: 'closed' } | { kind: 'open'; group: Group };

/**
 * The gate of a point. `closed`: every action of the point is done or may fail without stopping
 * the pipeline, so the pipeline goes on. `open`: the pipeline waits for `group`.
 */
export function nextAction(state: RunState, point: ActionPoint): NextAction {
  if (pointClosed(state, point)) return { kind: 'closed' };
  const group = openAction(state, point);
  return group ? { kind: 'open', group } : { kind: 'closed' };
}

/** Whether `group` may start now: it is the first open action of its point. */
export function actionMayStart(state: RunState, group: Group): boolean {
  const point = actionPointOf(group);
  if (point === undefined) return true;
  return openAction(state, point) === group;
}

/** Where the groups of a point stand among the groups of a run (`Group.position`). */
const POINT_POSITION: Record<ActionPoint, number> = {
  before_split: -2_000_000,
  after_split: -1_000_000,
  before_delivery: 999_000,
  after_delivery: 1_000_100,
};

function runTask(state: RunState): string {
  return state.split?.task ?? state.groups.map((group) => group.task).join('\n\n');
}

function actionTask(state: RunState, action: Action, point: ActionPoint): string {
  return [
    `Pipeline action \`${actionName(action)}\` of run ${state.run.id} (${point.replaceAll('_', ' ')}).`,
    `Task of the run:\n${runTask(state)}`,
  ].join('\n\n');
}

/**
 * Enters a point of the pipeline: queues a group for every action of the point in the order of the
 * list. A group that already exists (an earlier pass through the point) starts over, keeping its
 * attempts. Returns the groups of the point; the list is empty when the point has no actions.
 */
export function enterPoint(state: RunState, point: ActionPoint): Group[] {
  const pipeline = runPipeline(state.run);
  const ids = pipelineActionIds(state.run.config, pipeline, point);
  const groups: Group[] = [];
  for (const [index, id] of ids.entries()) {
    const action = findAction(state.run.config, id);
    if (!action) continue;
    const slug = actionSlug(point, id);
    const existing = state.actions.find((group) => group.slug === slug);
    if (existing) {
      existing.status = 'queued';
      existing.pending = freshPending(0);
      existing.reason = null;
      existing.question = null;
      existing.questions = null;
      existing.humanOnly = null;
      groups.push(existing);
      continue;
    }
    const group = newGroup(
      slug,
      actionName(action),
      actionTask(state, action, point),
      POINT_POSITION[point] + index,
    );
    state.actions.push(group);
    groups.push(group);
  }
  state.actions.sort(
    (left, right) =>
      ACTION_POINTS.indexOf(actionPointOf(left) ?? 'before_split') -
        ACTION_POINTS.indexOf(actionPointOf(right) ?? 'before_split') ||
      left.position - right.position,
  );
  return groups;
}

/** The point has groups, so the pipeline passed through it. */
export function pointEntered(state: RunState, point: ActionPoint): boolean {
  return actionGroupsOf(state, point).length > 0;
}
