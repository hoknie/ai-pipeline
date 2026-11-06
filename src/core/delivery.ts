import { Rejection } from './errors.ts';
import {
  MESSAGE_GROUP,
  RESOLVE_GROUP,
  actionGroupsOf,
  freshPending,
  isHeldByAction,
  newGroup,
  pointClosed,
  pointStalled,
  type Group,
  type GroupDelivery,
  type PendingDelivery,
  type RunState,
} from './model.ts';
import { closeRepair, deliveryKeys, openRepairGroup, repairTask } from './observer.ts';
import { enterPoint, pointEntered } from './stages.ts';

export type DeliveryEffect =
  | {
      kind: 'deliver';
      run: string;
      groups: string[];
      force: boolean;
      message: string;
      auto: boolean;
    }
  | { kind: 'cleanup'; run: string }
  | { kind: 'prepare_resolve'; run: string; groups: string[]; round: number }
  | { kind: 'finish_resolve'; run: string; groups: string[]; message: string; conflicts: string[] };

export interface DeliveryRequest {
  groups: string[] | null;
  force: boolean;
  files: string[];
  auto: boolean;
}

export type DeliveryResult =
  | {
      kind: 'applied';
      files: string[];
      conflicts: string[];
      commit: string | null;
      userEdits?: string[];
    }
  | { kind: 'refused'; reason: string; files: string[]; conflict?: boolean }
  | { kind: 'failed'; message: string };

function deliverable(group: Group): boolean {
  return group.status === 'merged' && group.delivery.state !== 'applied';
}

export function selectGroups(state: RunState, requested: string[] | null): Group[] {
  if (state.run.refStyle === 'branches') {
    throw new Rejection(
      `run ${state.run.id} keeps its result on branch ${state.run.branch}; merge it with \`git merge ${state.run.branch}\``,
    );
  }
  if (requested === null || requested.length === 0) {
    const groups = state.groups.filter(deliverable);
    if (groups.length === 0)
      throw new Rejection('nothing to deliver: no merged groups are waiting');
    return groups;
  }
  return requested.map((slug) => requestedGroup(state, slug, 'delivered'));
}

function requestedGroup(state: RunState, slug: string, verb: string): Group {
  const group = state.groups.find((candidate) => candidate.slug === slug);
  if (!group) throw new Rejection(`unknown group \`${slug}\``);
  if (group.delivery.state === 'applied')
    throw new Rejection(`group \`${slug}\` is already delivered`);
  if (group.status !== 'merged') {
    throw new Rejection(`group \`${slug}\` is ${group.status}; only merged groups can be ${verb}`);
  }
  return group;
}

/**
 * The user merged the result by hand: mark merged groups delivered without any git operation.
 * `null` or an empty list selects every merged group that is not delivered yet.
 */
export function markDelivered(
  state: RunState,
  requested: string[] | null,
  now: number,
): DeliveryEffect[] {
  if (state.run.pendingDelivery !== null) {
    throw new Rejection(`a delivery of run ${state.run.id} is already in progress`);
  }
  let groups: Group[];
  if (requested === null || requested.length === 0) {
    groups = state.groups.filter(deliverable);
    if (groups.length === 0)
      throw new Rejection('nothing to mark: no merged groups are waiting for delivery');
  } else {
    groups = requested.map((slug) => requestedGroup(state, slug, 'marked delivered'));
  }
  for (const group of groups) {
    group.delivery = {
      state: 'applied',
      reason: null,
      files: [],
      conflicts: [],
      userEdits: [],
      manual: true,
      finishedAt: now,
    };
  }
  return cleanupIfDelivered(state);
}

/** Every merged group is delivered and every group of the run has settled. */
function allDelivered(state: RunState): boolean {
  const merged = state.groups.filter((group) => group.status === 'merged');
  const everything =
    merged.length > 0 && merged.every((group) => group.delivery.state === 'applied');
  const settled = state.groups.every((group) =>
    ['merged', 'failed', 'cancelled'].includes(group.status),
  );
  return everything && settled;
}

/**
 * The actions after delivery have run (or were never due), so the run may be cleaned up. True
 * only when the point was entered: a run without such actions is cleaned up at once.
 */
export function afterDeliveryDone(state: RunState): boolean {
  return (
    allDelivered(state) &&
    pointEntered(state, 'after_delivery') &&
    pointClosed(state, 'after_delivery')
  );
}

/**
 * When every group is delivered: starts the actions after delivery (not after a delivery the user
 * marked by hand), and cleans the run up once they are done, unless `delivery.keep` is set.
 */
export function cleanupIfDelivered(state: RunState): DeliveryEffect[] {
  if (!allDelivered(state)) return [];
  const manual = state.groups.some((group) => group.status === 'merged' && group.delivery.manual);
  if (!manual && !pointEntered(state, 'after_delivery')) {
    if (enterPoint(state, 'after_delivery').length > 0) return [];
  }
  if (!pointClosed(state, 'after_delivery')) return [];
  return state.run.config.delivery.keep ? [] : [{ kind: 'cleanup', run: state.run.id }];
}

function lastSummary(group: Group): string {
  const finished = group.attempts.filter(
    (attempt) => attempt.status === 'finished' && attempt.report,
  );
  return finished.at(-1)?.report?.summary.split('\n')[0]?.trim() ?? '';
}

function title(state: RunState, groups: Group[]): string {
  if (groups.length === 1 && groups[0]) return groups[0].title;
  const task = state.split?.task.split('\n')[0]?.trim();
  if (task) return task.slice(0, 72);
  return `${groups.length} groups: ${groups.map((group) => group.title).join(', ')}`.slice(0, 72);
}

function task(state: RunState, groups: Group[]): string {
  if (state.split) return state.split.task;
  return groups.map((group) => group.task).join('\n\n');
}

export function renderCommitMessage(template: string, state: RunState, groups: Group[]): string {
  const values: Record<string, string> = {
    title: title(state, groups),
    task: task(state, groups),
    run: state.run.id,
    pipeline: state.run.pipeline,
    // The old name of `{pipeline}`, kept for templates written before the rename.
    workflow: state.run.pipeline,
    groups: groups.map((group) => `- ${group.title}: ${lastSummary(group)}`).join('\n'),
  };
  const text = template.replace(
    /\{(title|task|run|pipeline|workflow|groups)\}/g,
    (_, key: string) => values[key] ?? '',
  );
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function withPrompt(parts: string[], prompt: string | undefined): string {
  return (prompt ? [...parts, prompt] : parts).join('\n\n');
}

/** The fixed part of the task of the commit message author; the run adds its own sections. */
export const MESSAGE_INSTRUCTIONS = (run: string): string[] => [
  `Write a git commit message for the changes of run ${run}. The first line is a short subject; then a blank line and a body.`,
  `Report the full message as the summary of swarm_report with verdict "done". Do not change any files.`,
];

function messageTask(state: RunState, groups: Group[], files: string[]): string {
  return withPrompt(
    [
      ...MESSAGE_INSTRUCTIONS(state.run.id),
      `Task:\n${task(state, groups)}`,
      `Groups:\n${groups.map((group) => `- ${group.title}: ${lastSummary(group)}`).join('\n')}`,
      `Changed files:\n${files.map((file) => `- ${file}`).join('\n') || '- (none)'}`,
    ],
    state.run.config.delivery.messagePrompt,
  );
}

export function requestDelivery(
  state: RunState,
  request: DeliveryRequest,
  options: { resume?: boolean } = {},
): DeliveryEffect[] {
  if (state.run.pendingDelivery !== null) {
    throw new Rejection(`a delivery of run ${state.run.id} is already in progress`);
  }
  // A check queued behind a failed one does not run: a new request starts them all over.
  const checking = actionGroupsOf(state, 'before_delivery').filter(
    (group) =>
      ['queued', 'running', 'needs_human'].includes(group.status) && !isHeldByAction(state, group),
  );
  if (!options.resume && checking.length > 0) {
    throw new Rejection(
      `the actions before delivery of run ${state.run.id} are still running; wait for them or cancel them`,
    );
  }
  const groups = selectGroups(state, request.groups);
  const slugs = groups.map((group) => group.slug);
  state.run.pendingDelivery = {
    groups: slugs,
    force: request.force,
    auto: request.auto,
    files: request.files,
  };
  if (!options.resume && enterPoint(state, 'before_delivery').length > 0) {
    state.run.pendingDelivery.checks = true;
    return [];
  }
  return startDelivery(state);
}

/** The actions before delivery are settled: the commit message author, or the delivery itself. */
function startDelivery(state: RunState): DeliveryEffect[] {
  const pending = state.run.pendingDelivery;
  if (!pending) return [];
  const groups = state.groups.filter((group) => pending.groups.includes(group.slug));
  const { delivery } = state.run.config;
  if (delivery.mode === 'commit' && delivery.messageSpecialist) {
    state.message = newGroup(
      MESSAGE_GROUP,
      'commit message',
      messageTask(state, groups, pending.files ?? []),
      1_000_000,
    );
    return [];
  }
  return [deliverEffect(state, renderCommitMessage(delivery.commitMessage, state, groups))];
}

/**
 * Moves a delivery that waits for the actions before it: on once they are settled, cancelled when
 * one of them stopped the pipeline (the groups stay undelivered and delivery can be requested again).
 */
export function advanceChecks(state: RunState): DeliveryEffect[] {
  const pending = state.run.pendingDelivery;
  if (!pending?.checks) return [];
  if (pointClosed(state, 'before_delivery')) {
    pending.checks = false;
    return startDelivery(state);
  }
  if (pointStalled(state, 'before_delivery')) state.run.pendingDelivery = null;
  return [];
}

function deliverEffect(state: RunState, message: string): DeliveryEffect {
  const pending = state.run.pendingDelivery;
  if (!pending) throw new Error('no pending delivery');
  pending.message = message;
  return {
    kind: 'deliver',
    run: state.run.id,
    groups: pending.groups,
    force: pending.force,
    message,
    auto: pending.auto,
  };
}

export function finishMessage(state: RunState, summary: string | null): DeliveryEffect[] {
  const pending = state.run.pendingDelivery;
  if (!pending) return [];
  const groups = state.groups.filter((group) => pending.groups.includes(group.slug));
  const message = summary?.trim()
    ? summary.trim()
    : renderCommitMessage(state.run.config.delivery.commitMessage, state, groups);
  return [deliverEffect(state, message)];
}

export function cancelDelivery(state: RunState): void {
  state.run.pendingDelivery = null;
}

function shouldResolve(state: RunState, pending: PendingDelivery, result: DeliveryResult): boolean {
  // An observer repairs a delivery once: there are no resolver rounds.
  if (pending.repair) return false;
  const { resolver, resolverRounds } = state.run.config.delivery;
  if (!resolver || pending.force || result.kind === 'applied') return false;
  const round = pending.round ?? 0;
  if (round >= resolverRounds) return false;
  return round > 0 || (result.kind === 'refused' && result.conflict === true);
}

/** The fixed part of the task of the resolver; the run adds its own sections. */
export const RESOLVE_INSTRUCTIONS = (run: string): string[] => [
  `Your working directory holds the user's current working tree with the changes of run ${run} applied on top. The files below contain git conflict markers (<<<<<<<, =======, >>>>>>>) where the changes of the run and the user's own edits collide.`,
  'Resolve every conflict so that both the edits of the user and the intent of the run are kept. Remove every conflict marker, run the checks of the project if you can, and report done. Report rejected if the conflicts cannot be resolved safely.',
  'Run the checks in the foreground and wait for their result in the same shell command, with a timeout long enough for the whole check (up to 10 minutes). Never start them in the background and never wait for them with `pgrep`, `pkill` or `sleep` loops: the name of the check command also appears in the command lines of other agents and of your own shell, so such a wait never ends.',
];

function resolveTask(state: RunState, groups: Group[], conflicts: string[]): string {
  return withPrompt(
    [
      ...RESOLVE_INSTRUCTIONS(state.run.id),
      `Conflicting files:\n${conflicts.map((file) => `- ${file}`).join('\n')}`,
      `Task of the run:\n${task(state, groups)}`,
      `Groups:\n${groups.map((group) => `- ${group.title}: ${lastSummary(group)}`).join('\n')}`,
    ],
    state.run.config.delivery.resolverPrompt,
  );
}

/** The resolver worktree is ready; `conflicts` lists the files with conflict markers. */
export function resolvePrepared(state: RunState, conflicts: string[]): DeliveryEffect[] {
  const pending = state.run.pendingDelivery;
  if (!pending) return [];
  pending.conflicts = conflicts;
  if (conflicts.length === 0) return [finishResolveEffect(state, pending)];
  const groups = state.groups.filter((group) => pending.groups.includes(group.slug));
  const incident = state.run.repair.incident;
  if (pending.repair && incident) {
    openRepairGroup(state, repairTask(state, incident, { conflicts }));
    return [];
  }
  const text = resolveTask(state, groups, conflicts);
  if (state.resolve === null) {
    state.resolve = newGroup(RESOLVE_GROUP, 'resolve delivery conflicts', text, 1_000_001);
  } else {
    state.resolve.task = text;
    state.resolve.status = 'queued';
    state.resolve.pending = freshPending(0);
    state.resolve.reason = null;
    state.resolve.question = null;
  }
  return [];
}

function finishResolveEffect(state: RunState, pending: PendingDelivery): DeliveryEffect {
  return {
    kind: 'finish_resolve',
    run: state.run.id,
    groups: pending.groups,
    message: pending.message ?? '',
    conflicts: pending.conflicts ?? [],
  };
}

/** The resolver reported done: commit its worktree and deliver the result. */
export function resolverDone(state: RunState): DeliveryEffect[] {
  const pending = state.run.pendingDelivery;
  return pending ? [finishResolveEffect(state, pending)] : [];
}

export function finishDelivery(
  state: RunState,
  result: DeliveryResult,
  now: number,
): DeliveryEffect[] {
  const pending = state.run.pendingDelivery;
  if (!pending) return [];
  if (shouldResolve(state, pending, result)) {
    pending.round = (pending.round ?? 0) + 1;
    if (result.kind === 'refused' && result.files.length > 0) pending.conflicts = result.files;
    return [
      { kind: 'prepare_resolve', run: state.run.id, groups: pending.groups, round: pending.round },
    ];
  }
  const repairKeys = pending.repair ? deliveryKeys(state, pending.groups) : [];
  state.run.pendingDelivery = null;
  const outcome =
    result.kind === 'failed' && (pending.round ?? 0) > 0
      ? { kind: 'refused' as const, reason: result.message, files: pending.conflicts ?? [] }
      : result;
  for (const group of state.groups.filter((candidate) => pending.groups.includes(candidate.slug))) {
    group.delivery = {
      ...deliveryOf(outcome, now),
      ...(outcome.kind === 'applied' ? { message: pending.message ?? null } : {}),
    };
  }
  if (pending.repair) {
    // The delivery ends the repair of a delivery incident, whatever its result.
    const repairGroup = state.repair;
    if (repairGroup?.status === 'queued') {
      repairGroup.status = 'failed';
      repairGroup.reason = 'delivery ended';
      repairGroup.pending = null;
    }
    const incident = state.run.repair.incident;
    closeRepair(state, {
      taken: [...(incident ? [incident.key] : []), ...repairKeys],
      refund: false,
    });
  }
  return cleanupIfDelivered(state);
}

function deliveryOf(result: DeliveryResult, now: number): GroupDelivery {
  switch (result.kind) {
    case 'applied':
      return {
        state: 'applied',
        reason: null,
        files: result.files,
        conflicts: result.conflicts,
        userEdits: result.userEdits ?? [],
        manual: false,
        finishedAt: now,
      };
    case 'refused':
      return {
        state: 'apply_failed',
        reason: result.reason,
        files: result.files,
        conflicts: [],
        userEdits: [],
        manual: false,
        finishedAt: now,
      };
    case 'failed':
      return {
        state: 'apply_failed',
        reason: result.message,
        files: [],
        conflicts: [],
        userEdits: [],
        manual: false,
        finishedAt: now,
      };
  }
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
