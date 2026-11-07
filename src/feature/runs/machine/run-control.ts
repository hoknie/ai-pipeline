import { isRejected, rejected } from '../../../platform/errors/index.ts';
import {
  type PermissionsRefresh,
  type SpecialistsRefresh,
  refreshSpecialists,
} from '../../agents/types/index.ts';
import {
  type Group,
  type PendingDelivery,
  type RunHold,
  REPAIR_GROUP,
  actionGroupsOf,
  allGroups,
  attemptVerdict,
  deliveryCheckActive,
  isActionGroup,
  isMessageGroup,
  isRepairGroup,
  isResolveGroup,
  isServiceGroup,
  isTerminal,
  lastUnskipped,
  pointClosed,
  pointStalled,
  stepsOf,
} from '../types/index.ts';
import { refreshPermissionsOf, wrongStatus } from './answers.ts';
import { cancelDelivery, requestDelivery } from './delivery-flow.ts';
import type { Ctx, MergeOutcome } from './events.ts';
import { closeRepair, stopRepair } from './repair.ts';
import {
  continueAfterMessage,
  continueAfterPause,
  enqueueMerge,
  failGroup,
  groupOf,
  restorePending,
} from './steps.ts';

/** Stops the running agents of the groups before delivery; their steps go on after the pause. */
function pauseAttempts(m: Ctx): void {
  const groups = [
    ...actionGroupsOf(m.state, 'before_split'),
    ...(m.state.split ? [m.state.split] : []),
    ...actionGroupsOf(m.state, 'after_split'),
    ...m.state.groups,
  ];
  for (const group of groups) {
    for (const attempt of group.attempts) {
      if (attempt.status !== 'running' || attempt.report !== null || attempt.reason !== null) {
        continue;
      }
      // A command cannot continue after a pause; it runs to its end.
      if (attempt.runtime === 'command') continue;
      attempt.reason = { kind: 'paused', at: m.now };
      m.effects.push({
        kind: 'stop_attempt',
        run: m.state.run.id,
        group: group.slug,
        seq: attempt.seq,
      });
    }
  }
}

export function holdRun(m: Ctx, hold: RunHold | null): void {
  if (hold !== null && m.state.run.finishedAt !== null && m.state.run.hold === null) {
    throw rejected('a finished run cannot be held');
  }
  const pausing = hold === 'paused' && m.state.run.hold !== 'paused';
  m.state.run.hold = hold;
  if (!pausing) return;
  // A pause stops the running agents; their steps go on in the same session after it.
  pauseAttempts(m);
  // A repair does not continue after a pause: its incident is taken again, and it is not counted.
  stopRepair(m, { reason: 'paused', refund: true });
}

/** Cancels the running attempts of a group. */
function cancelAttempts(m: Ctx, group: Group): void {
  for (const attempt of group.attempts) {
    if (attempt.status !== 'running') continue;
    attempt.status = 'cancelled';
    attempt.finishedAt = m.now;
    m.effects.push({
      kind: 'stop_attempt',
      run: m.state.run.id,
      group: group.slug,
      seq: attempt.seq,
    });
  }
}

export function cancelGroups(m: Ctx, only: string | null, reason?: string): void {
  if (only === REPAIR_GROUP && m.state.repair === null) {
    // The tree of a delivery repair is still being prepared: there is no group to cancel yet.
    stopRepair(m, { reason: null, refund: false });
    return;
  }
  const groups = only === null ? allGroups(m.state) : [groupOf(m, only)];
  for (const group of groups) {
    // A failed action can be cancelled by name: that releases the pipeline held by it.
    const failedAction = only !== null && isActionGroup(group) && group.status === 'failed';
    if (isTerminal(group.status) && !failedAction) continue;
    group.status = 'cancelled';
    if (reason !== undefined) group.reason = reason;
    group.mergeInFlight = false;
    if (isMessageGroup(group) || isResolveGroup(group)) cancelDelivery(m.state);
    cancelAttempts(m, group);
  }
  if (only === null || only === REPAIR_GROUP) {
    if (only === null && reason !== undefined) m.state.run.repair.cancelReason = reason;
    stopRepair(m, { reason: null, refund: false });
  }
  // Cancelling the whole run also cancels a delivery that waits for the checks, even when the
  // cancelled checks do not stop the pipeline.
  if (only === null && m.state.run.pendingDelivery?.checks) {
    cancelDelivery(m.state);
    m.checksCancelled = true;
  }
}

/** The attempts of a group that were running when the daemon stopped. */
function interruptGroup(m: Ctx, group: Group): void {
  let wasRunning = false;
  for (const attempt of group.attempts) {
    if (attempt.status !== 'running') continue;
    if (attempt.reason?.kind === 'message') {
      continueAfterMessage(m, group, attempt, attempt.reason);
      continue;
    }
    if (attempt.reason?.kind === 'paused') {
      continueAfterPause(m, group, attempt);
      continue;
    }
    attempt.status = 'failed';
    attempt.reason = { kind: 'interrupted' };
    attempt.finishedAt = m.now;
    wasRunning = true;
  }
  group.mergeInFlight = false;
  if (wasRunning) failGroup(m, group, { kind: 'interrupted' });
}

/** A repair delivery is not resumed: the incident is taken again. */
function dropRepairDelivery(m: Ctx): void {
  const group = m.state.repair;
  if (group && !isTerminal(group.status)) {
    group.status = 'failed';
    group.reason = 'interrupted';
    group.pending = null;
  }
  closeRepair(m.state, { taken: [], refund: false });
}

/** A delivery that waited for the checks when the daemon stopped. */
function resumeChecks(m: Ctx, delivery: PendingDelivery): void {
  if (pointStalled(m.state, 'before_delivery')) {
    for (const group of actionGroupsOf(m.state, 'before_delivery')) {
      if (group.status !== 'queued') continue;
      group.status = 'cancelled';
      group.reason = 'delivery interrupted';
    }
  } else {
    // The interrupted check may fail without stopping the pipeline: the delivery goes on
    // after the remaining checks, without entering the point (and running the command) again.
    m.state.run.pendingDelivery = delivery;
  }
}

export function interrupted(m: Ctx): void {
  // Whatever the delivery was doing (git work, the message writer, the resolver) died with
  // the old daemon; drop it before failing its service groups, then start it again.
  const delivery = m.state.run.pendingDelivery;
  m.state.run.pendingDelivery = null;
  for (const group of allGroups(m.state)) interruptGroup(m, group);
  if (delivery?.repair) {
    dropRepairDelivery(m);
    return;
  }
  if (delivery?.checks) resumeChecks(m, delivery);
  // An interrupted action before delivery is not started again: the delivery waits for a new request.
  if (delivery && !delivery.checks && pointClosed(m.state, 'before_delivery')) {
    try {
      m.effects.push(
        ...requestDelivery(
          m.state,
          {
            groups: delivery.groups,
            force: delivery.force,
            files: delivery.files ?? [],
            auto: delivery.auto,
          },
          { resume: true },
        ),
      );
    } catch (error) {
      if (!isRejected(error)) throw error;
    }
  }
}

export function mergeFinished(m: Ctx, slug: string, outcome: MergeOutcome): void {
  const group = groupOf(m, slug);
  if (group.status !== 'merging' || !group.mergeInFlight) return;
  group.mergeInFlight = false;
  group.updateOnConflict = false;
  switch (outcome.kind) {
    case 'merged':
      group.status = 'merged';
      group.mergeCommit = outcome.commit;
      group.conflictFiles = [];
      group.reason = null;
      break;
    case 'conflict':
      group.status = 'conflict';
      group.conflictFiles = outcome.files;
      group.reason = `merge conflict in ${outcome.files.join(', ')}`;
      break;
    case 'conflict_updated':
      group.status = 'queued';
      group.conflictFiles = outcome.files;
      group.reason = null;
      group.pending = {
        stepIndex: lastUnskipped(m.state.run, group),
        feedback: `The branch of this group was updated from the run branch and has merge conflicts in: ${outcome.files.join(', ')}. Resolve every conflict, keep the intent of both sides, and report done.`,
        humanAnswer: null,
        resume: false,
      };
      break;
    case 'failed':
      failGroup(m, group, { kind: 'git', message: outcome.message });
      break;
  }
}

export function startNextMerge(m: Ctx): void {
  if (m.state.groups.some((group) => group.mergeInFlight)) return;
  if (deliveryCheckActive(m.state)) return;
  const next = m.state.groups
    .filter((group) => group.status === 'merging')
    .sort((left, right) => (left.mergeSeq ?? 0) - (right.mergeSeq ?? 0))[0];
  if (!next) return;
  next.mergeInFlight = true;
  m.effects.push({
    kind: 'merge',
    run: m.state.run.id,
    group: next.slug,
    updateOnConflict: next.updateOnConflict,
  });
}

function rejectDeliveryRetry(group: Group): void {
  if (isMessageGroup(group) || isResolveGroup(group)) {
    throw rejected(
      `group ${group.slug} is ${group.status}; delivery is retried with \`aip run apply\``,
    );
  }
  if (isRepairGroup(group)) {
    throw rejected(`group ${group.slug} is ${group.status}; observers take a repair again`);
  }
}

function retryCancelled(m: Ctx, group: Group): void {
  group.reason = null;
  if (group.question !== null) {
    group.status = 'needs_human';
    return;
  }
  const last = group.attempts.at(-1);
  if (
    group.pending === null &&
    last &&
    !isServiceGroup(group) &&
    attemptVerdict(last) === 'done' &&
    last.stepIndex + 1 >= stepsOf(m.state.run, group).length
  ) {
    enqueueMerge(m, group, false);
    return;
  }
  restorePending(group);
  group.status = 'queued';
}

export function retryGroup(
  m: Ctx,
  slug: string,
  permissions?: PermissionsRefresh,
  specialists?: SpecialistsRefresh,
): void {
  const group = groupOf(m, slug);
  if (group.status === 'failed' || group.status === 'cancelled') rejectDeliveryRetry(group);
  if (group.status === 'failed') {
    group.status = 'queued';
    group.reason = null;
  } else if (group.status === 'conflict') {
    enqueueMerge(m, group, true);
  } else if (group.status === 'cancelled') {
    retryCancelled(m, group);
  } else {
    throw wrongStatus(group, 'retry', 'failed, cancelled or conflict');
  }
  // After every check: a refused retry leaves the snapshot as it was.
  if (specialists) {
    const changes = refreshSpecialists(m.state.run.config, specialists);
    group.warnings.push(
      `config refreshed: ${changes.length > 0 ? changes.join('; ') : 'no changes'}`,
    );
  } else {
    refreshPermissionsOf(m, group, permissions);
  }
}
