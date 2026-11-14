import type { Usage } from '../../agents/types/index.ts';
import {
  type ActionPoint,
  type Pipeline,
  type ResolvedConfig,
  type Specialist,
  type SpecialistLevel,
  type StepAgent,
  findPipeline,
  stepSpecialist,
} from '../../swarm-config/types/index.ts';
import {
  type IncidentKind,
  type RefStyle,
  type RunHold,
  ACTION_GROUP_PREFIX,
  MESSAGE_GROUP,
  REPAIR_GROUP,
  RESOLVE_GROUP,
  SPLIT_GROUP,
  isTerminal,
} from './constants.ts';
import { type Group, actionOf, actionPointOf, isRepairGroup } from './group.ts';

/** A file attached to the task of a run; the bytes live in the attachment storage. */
export interface RunAttachment {
  id: string;
  fileName: string;
  size: number;
  mediaType: string;
}

export interface Run {
  id: string;
  repository: string;
  pipeline: string;
  /** Id of the pipeline variant the run follows; `default` for the pipeline as it is. */
  variant: string;
  baseCommit: string;
  branch: string;
  refStyle: RefStyle;
  createdAt: number;
  finishedAt: number | null;
  config: ResolvedConfig;
  dirtyWarning: boolean;
  nextMergeSeq: number;
  pendingDelivery: PendingDelivery | null;
  /** Short title in the language of the task; null until known. */
  title: string | null;
  /** English kebab-case name, like the name of an OpenSpec change. */
  name: string | null;
  /** Usage of the call that named the run. */
  namingUsage: Usage | null;
  /** Created by a task queue. */
  fromQueue: boolean;
  /** Id of the queue item the run started from; null for a run outside the queue. */
  queueItem: string | null;
  /** Number of the task the run was created for. */
  number: number;
  /** Ids of catalog tags. */
  tags: string[];
  /** Steps skipped after the start; the step list of the snapshot is unchanged. */
  skippedSteps: string[];
  /** The run is held and starts no step; null when it runs normally. */
  hold: RunHold | null;
  /** State of the observer repairs of the run. */
  repair: RunRepair;
  /** Files attached to the task; fixed when the run is created. */
  attachments: RunAttachment[];
}

/** A state of a group an observer repairs; `key` includes the attempts of the group. */
export interface Incident {
  key: string;
  kind: IncidentKind;
  group: string;
  detail: string;
}

export interface RunRepair {
  /** An observer may take the incidents of the run. */
  allowed: boolean;
  /** Repairs started for the run. */
  repairs: number;
  /** Keys of incidents the observer reported on. */
  taken: string[];
  /** The incident being repaired; set from the start of a repair to its end. */
  incident: Incident | null;
  /** Profile of the observer when the repair started. */
  specialist: Specialist | null;
  /** Why the observer cancelled the whole run. */
  cancelReason: string | null;
}

export function emptyRepair(): RunRepair {
  return {
    allowed: true,
    repairs: 0,
    taken: [],
    incident: null,
    specialist: null,
    cancelReason: null,
  };
}

export interface PendingDelivery {
  groups: string[];
  force: boolean;
  auto: boolean;
  /** Commit message of the delivery, once known. */
  message?: string | null;
  /** Resolver rounds started for this delivery. */
  round?: number;
  /** Files that conflicted in the last attempt. */
  conflicts?: string[];
  /** Files the delivery changes, as the request named them; for the commit message author. */
  files?: string[];
  /** The delivery waits for the actions before it. */
  checks?: boolean;
  /** An observer repairs the delivery: no commit message author, no resolver rounds. */
  repair?: boolean;
}

export interface RunState {
  run: Run;
  split: Group | null;
  groups: Group[];
  message: Group | null;
  resolve: Group | null;
  /** The group of the repairs of an observer; one attempt per repair. */
  repair: Group | null;
  /** Groups of pipeline actions in the order of the points, then of the lists of the points. */
  actions: Group[];
}

export function runPipeline(run: Run): Pipeline {
  const pipeline = findPipeline(run.config, run.pipeline);
  if (!pipeline) throw new Error(`run ${run.id} has no pipeline ${run.pipeline}`);
  return pipeline;
}

export function runRef(run: Run): string {
  return run.branch;
}

export function groupRef(run: Run, group: string): string {
  return run.refStyle === 'refs' ? `refs/aip/${run.id}/groups/${group}` : `${run.branch}-${group}`;
}

export function deliveryBranch(run: Run): string {
  return `aip/${run.id}`;
}

export function findGroup(state: RunState, slug: string): Group | undefined {
  if (slug === SPLIT_GROUP) return state.split ?? undefined;
  if (slug === MESSAGE_GROUP) return state.message ?? undefined;
  if (slug === RESOLVE_GROUP) return state.resolve ?? undefined;
  if (slug === REPAIR_GROUP) return state.repair ?? undefined;
  if (slug.startsWith(ACTION_GROUP_PREFIX)) {
    return (state.actions ?? []).find((group) => group.slug === slug);
  }
  return state.groups.find((group) => group.slug === slug);
}

/** The action groups of one point in the order of its list. */
export function actionGroupsOf(state: RunState, point: ActionPoint): Group[] {
  return (state.actions ?? []).filter((group) => actionPointOf(group) === point);
}

export function allGroups(state: RunState): Group[] {
  return [
    ...actionGroupsOf(state, 'before_split'),
    ...(state.split ? [state.split] : []),
    ...actionGroupsOf(state, 'after_split'),
    ...state.groups,
    ...actionGroupsOf(state, 'before_delivery'),
    ...(state.message ? [state.message] : []),
    ...(state.resolve ? [state.resolve] : []),
    ...(state.repair ? [state.repair] : []),
    ...actionGroupsOf(state, 'after_delivery'),
  ];
}

/** Settled for the pipeline: the action is done, or failed and the pipeline goes on anyway. */
export function actionClosed(run: Run, group: Group): boolean {
  if (group.status === 'merged') return true;
  const action = actionOf(run, group);
  if (group.status === 'failed') return action?.onFailure === 'continue';
  // Cancelling a command after delivery only releases the cleanup.
  if (group.status === 'cancelled') {
    return action?.onFailure === 'continue' || actionPointOf(group) === 'after_delivery';
  }
  return false;
}

/** Every action of the point is settled; also true for a point that has no actions. */
export function pointClosed(state: RunState, point: ActionPoint): boolean {
  return actionGroupsOf(state, point).every((group) => actionClosed(state.run, group));
}

/** The first action of the point that is not settled. */
export function openAction(state: RunState, point: ActionPoint): Group | undefined {
  return actionGroupsOf(state, point).find((group) => !actionClosed(state.run, group));
}

/** The open action of the point stopped the pipeline and waits for a retry. */
export function pointStalled(state: RunState, point: ActionPoint): boolean {
  const open = openAction(state, point);
  return open !== undefined && (open.status === 'failed' || open.status === 'cancelled');
}

/** A queued group that waits for an action which stopped the pipeline: only a retry frees it. */
export function isHeldByAction(state: RunState, group: Group): boolean {
  if (group.status !== 'queued') return false;
  const point = actionPointOf(group);
  if (point !== undefined) {
    const open = openAction(state, point);
    return open !== undefined && open !== group && pointStalled(state, point);
  }
  if (group === state.split) return pointStalled(state, 'before_split');
  if (state.groups.includes(group)) return pointStalled(state, 'after_split');
  return false;
}

/**
 * A check before delivery works in the tree of the run or is about to, and merges use that tree.
 * A check that stopped the pipeline, and the ones held behind it, keep no merge waiting.
 */
export function deliveryCheckActive(state: RunState): boolean {
  return actionGroupsOf(state, 'before_delivery').some(
    (group) =>
      group.status === 'running' || (group.status === 'queued' && !isHeldByAction(state, group)),
  );
}

/** Action groups that failed or were cancelled and stop the pipeline. */
export function stoppedActions(state: RunState, status: 'failed' | 'cancelled'): Group[] {
  return (state.actions ?? []).filter(
    (group) => group.status === status && !actionClosed(state.run, group),
  );
}

function groupsSettled(state: RunState, units: Group[]): boolean {
  return (
    units.length > 0 &&
    units.every((group) => isTerminal(group.status) || isHeldByAction(state, group))
  );
}

/** A run with an incident under repair is not finished, even before the repair group exists. */
export function isRunFinished(state: RunState): boolean {
  return state.run.repair.incident === null && groupsSettled(state, allGroups(state));
}

/**
 * Finished as `isRunFinished` is, but without the incident under repair and without the repair
 * group: the view of the queue on a run an observer works on.
 */
export function finishedApartFromRepair(state: RunState): boolean {
  // Without an incident the run is finished exactly when `finishedAt` is set.
  if (state.run.repair.incident === null) return state.run.finishedAt !== null;
  return groupsSettled(
    state,
    allGroups(state).filter((group) => !isRepairGroup(group)),
  );
}

/** The specialist of a step: the snapshot of the observer for the repair group, else the config. */
export function specialistOfStep(
  run: Run,
  group: Group,
  step: { specialist: string; agent?: StepAgent },
): Specialist | undefined {
  if (isRepairGroup(group)) return run.repair.specialist ?? undefined;
  return stepSpecialist(run.config, step);
}

/** Work groups and the split step of a run that a retry can continue. */
export function retryableGroups(state: RunState): string[] {
  const work = [...(state.split ? [state.split, ...state.groups] : state.groups), ...state.actions];
  return work
    .filter((group) => group.status === 'failed' || group.status === 'cancelled')
    .map((group) => group.slug);
}

export function deliveryCounts(state: RunState): {
  applied: number;
  merged: number;
  failed: number;
} {
  const merged = state.groups.filter((group) => group.status === 'merged');
  return {
    applied: merged.filter((group) => group.delivery.state === 'applied').length,
    merged: merged.length,
    failed: merged.filter((group) => group.delivery.state === 'apply_failed').length,
  };
}

/** Title of a run: the one it was named with, or the first line of its task. */
export function runTitle(state: RunState): string {
  if (state.run.title) return state.run.title;
  const source =
    state.split?.task ?? (state.groups.length === 1 ? state.groups[0]?.task : undefined);
  const line =
    source
      ?.split('\n')
      .find((part) => part.trim() !== '')
      ?.trim() ?? state.groups.map((group) => group.title).join(', ');
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export interface SpecialistRunning {
  slug: string;
  title: string;
  step: string;
  stepName: string;
  startedAt: number;
}

export interface SpecialistWaiting {
  slug: string;
  title: string;
  step: string;
  stepName: string;
}

/** What one run does with one specialist now: attempts it runs and groups waiting for it. */
export interface SpecialistUse {
  specialist: string;
  /** Human name of the specialist; the slug without a name. */
  name: string;
  level: SpecialistLevel;
  /** Limit of simultaneously running attempts of the specialist; null means no limit. */
  max: number | null;
  running: SpecialistRunning[];
  waiting: SpecialistWaiting[];
}

export interface StepProgress {
  /** Steps reached by all work groups; a return to an earlier step does not lower it. */
  done: number;
  /** Steps of all work groups; 0 while the task is split. */
  total: number;
  /** Step of the only group, counted from one; null with several groups or when all steps are passed. */
  current: { step: string; name: string; number: number } | null;
}
