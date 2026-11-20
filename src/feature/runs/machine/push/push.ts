import { rejected } from '../../../../platform/errors/index.ts';
import type { Group, RemoteBranch, RunState } from '../../types/index.ts';
import { cleanupIfDelivered } from '../delivery-checks.ts';
import type { DeliveryEffect } from '../events.ts';

/** Whether the branch of a delivery goes to the remote repository: only a `branch` delivery does. */
export function pushDue(state: RunState): boolean {
  const { delivery } = state.run.config;
  return delivery.push && delivery.mode === 'branch';
}

export function pushEffect(state: RunState): DeliveryEffect {
  return { kind: 'push', run: state.run.id };
}

function pushFailedGroups(state: RunState): Group[] {
  return state.groups.filter(
    (group) => group.status === 'merged' && group.delivery.state === 'push_failed',
  );
}

/**
 * A request to deliver names groups whose branch was not sent: only the sending is repeated, the
 * delivery itself is done. `null` when the request is about groups that still wait for delivery.
 */
export function retryPush(state: RunState, requested: string[] | null): DeliveryEffect[] | null {
  const failed = pushFailedGroups(state);
  const named = requested === null || requested.length === 0 ? null : requested;
  if (failed.length === 0 || (named !== null && !failed.some((g) => named.includes(g.slug)))) {
    return null;
  }
  if (state.run.pendingDelivery !== null) {
    throw rejected(`a delivery of run ${state.run.id} is already in progress`);
  }
  return [pushEffect(state)];
}

/** The branch is in the remote repository: the delivery is done, and the run may be cleaned up. */
export function pushed(state: RunState, remoteBranch: RemoteBranch): DeliveryEffect[] {
  state.run.remoteBranch = remoteBranch;
  for (const group of pushFailedGroups(state)) {
    group.delivery = { ...group.delivery, state: 'applied', reason: null };
  }
  return cleanupIfDelivered(state);
}

/**
 * The sending failed: the groups of the last delivery are not delivered yet, and the reason is
 * kept. The branch stays in the repository of the daemon.
 */
export function pushFailed(state: RunState, reason: string): void {
  const sent = state.groups.filter(
    (group) =>
      group.status === 'merged' && group.delivery.state === 'applied' && !group.delivery.manual,
  );
  const last = Math.max(0, ...sent.map((group) => group.delivery.finishedAt ?? 0));
  for (const group of sent.filter((candidate) => (candidate.delivery.finishedAt ?? 0) === last)) {
    group.delivery = { ...group.delivery, state: 'push_failed', reason };
  }
}
