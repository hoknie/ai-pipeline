import { rejected } from '../../../platform/errors/index.ts';
import {
  type GroupDelivery,
  type PendingDelivery,
  type RunState,
  MESSAGE_GROUP,
  RESOLVE_GROUP,
  actionGroupsOf,
  enterPoint,
  freshPending,
  isHeldByAction,
  newGroup,
  pointClosed,
  pointStalled,
} from '../types/index.ts';
import { cleanupIfDelivered, selectGroups } from './delivery-checks.ts';
import type { DeliveryEffect, DeliveryRequest, DeliveryResult } from './events.ts';
import { closeRepair, deliveryKeys, openRepairGroup, repairTask } from './repair.ts';
import { messageTask, renderCommitMessage, resolveTask } from './texts.ts';

export function requestDelivery(
  state: RunState,
  request: DeliveryRequest,
  options: { resume?: boolean } = {},
): DeliveryEffect[] {
  if (state.run.pendingDelivery !== null) {
    throw rejected(`a delivery of run ${state.run.id} is already in progress`);
  }
  // A check queued behind a failed one does not run: a new request starts them all over.
  const checking = actionGroupsOf(state, 'before_delivery').filter(
    (group) =>
      ['queued', 'running', 'needs_human'].includes(group.status) && !isHeldByAction(state, group),
  );
  if (!options.resume && checking.length > 0) {
    throw rejected(
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
