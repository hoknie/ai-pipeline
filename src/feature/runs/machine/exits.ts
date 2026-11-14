import {
  type Attempt,
  type FailReason,
  type Group,
  type OnLimit,
  type Report,
  actionPointOf,
  attemptStepLabel,
  enterPoint,
  freshPending,
  groupSlugs,
  hasNextChainItem,
  isActionGroup,
  isMessageGroup,
  isRepairGroup,
  isResolveGroup,
  isServiceGroup,
  isSplitGroup,
  limitHolds,
  newGroup,
  specialistOfStep,
  stepsOf,
} from '../types/index.ts';
import { NETWORK_FAILURE_LIMIT } from '../../network/types/index.ts';
import { finishDelivery, resolverDone } from './delivery-flow.ts';
import type { AttemptExit, Ctx } from './events.ts';
import { closeRepair } from './repair.ts';
import {
  advanceStep,
  askHuman,
  commitEffect,
  continueAfterMessage,
  continueAfterPause,
  failGroup,
  finishMessageGroup,
  groupOf,
  rejectedStep,
  restorePending,
  runningAttempt,
  waitForLimit,
} from './steps.ts';
import { reviewQuestion } from './texts.ts';

/** The attempt was cancelled or timed out before its process ended: only the usage is unknown. */
function lateUsage(group: Group, seq: number, exit: AttemptExit): void {
  const stopped = group.attempts.find((item) => item.seq === seq);
  if (stopped && exit.usage !== null && stopped.finishedAt !== null) stopped.usage = exit.usage;
}

/** The failure of an exited attempt; a report sent before the limit ran out counts as usual. */
function exitFailure(attempt: Attempt, exit: AttemptExit): FailReason | null {
  const limited =
    (exit.failure?.kind === 'usage_limit' || exit.failure?.kind === 'network') &&
    attempt.report !== null;
  if (limited) return null;
  return exit.failure ?? (attempt.report === null ? { kind: 'no_report' } : null);
}

function isFailoverError(kind: FailReason['kind']): boolean {
  return (
    kind === 'usage_limit' ||
    kind === 'runtime_not_found' ||
    kind === 'runtime_disabled' ||
    kind === 'spawn' ||
    kind === 'no_report'
  );
}

/** Network failures at the end of the attempts of the step, the last attempt included. */
function networkFailuresInRow(group: Group, stepIndex: number): number {
  let count = 0;
  for (const attempt of [...group.attempts].reverse()) {
    if (attempt.stepIndex !== stepIndex || attempt.reason?.kind !== 'network') break;
    count += 1;
  }
  return count;
}

function failAttempt(
  m: Ctx,
  group: Group,
  attempt: Attempt,
  failure: FailReason,
  onLimit: OnLimit,
): void {
  attempt.status = 'failed';
  attempt.reason = failure;
  const step = stepsOf(m.state.run, group)[attempt.stepIndex];
  const specialist = specialistOfStep(
    m.state.run,
    group,
    step ?? { specialist: attempt.specialist },
  );
  const chain = specialist?.runtimeChain
    ? m.state.run.config.chains.find((c) => c.slug === specialist.runtimeChain)
    : undefined;
  if (failure.kind === 'network' && !isRepairGroup(group)) {
    // The network is to blame, not the runtime: the same item of the chain tries again.
    if (networkFailuresInRow(group, attempt.stepIndex) >= NETWORK_FAILURE_LIMIT) {
      failGroup(m, group, failure);
      return;
    }
    waitForLimit(group, attempt, true);
    return;
  }
  const holds = limitHolds([m.state], m.now);
  if (
    isFailoverError(failure.kind) &&
    hasNextChainItem(chain, group.attempts, attempt.stepIndex, holds)
  ) {
    group.status = 'queued';
    group.pending = freshPending(attempt.stepIndex);
    return;
  }
  const roundHadLimit = group.attempts.some(
    (a) =>
      a.stepIndex === attempt.stepIndex &&
      a.round === attempt.round &&
      a.reason?.kind === 'usage_limit',
  );
  if (roundHadLimit && onLimit === 'wait' && !isRepairGroup(group)) {
    waitForLimit(group, attempt);
    return;
  }
  failGroup(m, group, failure);
}

export function attemptExited(m: Ctx, slug: string, seq: number, exit: AttemptExit): void {
  const group = groupOf(m, slug);
  const attempt = runningAttempt(group, seq);
  if (!attempt) {
    lateUsage(group, seq, exit);
    return;
  }
  attempt.finishedAt = m.now;
  if (exit.sessionId !== null) attempt.sessionId = exit.sessionId;
  attempt.usage = exit.usage ?? attempt.usage;
  attempt.denials = exit.denials ?? [];
  attempt.outsideChanges = [...exit.outsideChanges];
  if (attempt.reason?.kind === 'message') {
    continueAfterMessage(m, group, attempt, attempt.reason);
    return;
  }
  let current = exit;
  if (attempt.reason?.kind === 'paused') {
    if (attempt.report === null) {
      continueAfterPause(m, group, attempt);
      return;
    }
    // The report came before the stop: the exit failure is the stop itself.
    attempt.reason = null;
    current = { ...exit, failure: null };
  }
  const failure = exitFailure(attempt, current);
  if (failure !== null) {
    failAttempt(m, group, attempt, failure, current.onLimit ?? 'wait');
    return;
  }
  attempt.status = 'finished';
  reported(m, group, attempt, attempt.report as Report, current.outsideChanges);
}

/** The attempt ended with a report: commits, the check of outside changes, then the verdict. */
function reported(
  m: Ctx,
  group: Group,
  attempt: Attempt,
  report: Report,
  outsideChanges: string[],
): void {
  const point = actionPointOf(group);
  const commitsToRun = point === 'before_split' || point === 'after_split';
  if (report.verdict === 'done' && commitsToRun) {
    m.effects.push(commitEffect(m, group, attempt, report.summary));
  }
  if (report.verdict !== 'needs_human' && !isServiceGroup(group)) {
    m.effects.push(commitEffect(m, group, attempt, report.summary));
  }
  if (
    outsideChanges.length > 0 &&
    m.state.run.config.outsideChanges === 'stop' &&
    !isRepairGroup(group)
  ) {
    const files = outsideChanges.join(', ');
    askHuman(
      group,
      attempt.stepIndex,
      `Files in your working copy changed while step ${attemptStepLabel(m.state, group, attempt)} ran: ${files}. The specialist, you or another program may have changed them; aip deliveries are not counted. Check your working copy and answer to continue.`,
      null,
    );
    return;
  }
  verdictOf(m, group, attempt, report);
}

function askFromReport(group: Group, attempt: Attempt, report: Report): void {
  askHuman(
    group,
    attempt.stepIndex,
    report.feedback ?? '',
    report.questions ?? null,
    report.humanOnly ? 'request' : null,
  );
}

function verdictOf(m: Ctx, group: Group, attempt: Attempt, report: Report): void {
  if (isRepairGroup(group)) finishRepair(m, group, report);
  else if (isResolveGroup(group)) finishResolve(m, group, report);
  else if (isActionGroup(group)) finishAction(group, attempt, report);
  else if (report.verdict === 'done' && isMessageGroup(group)) {
    finishMessageGroup(m, group, report.summary);
  } else if (report.verdict === 'done' && isSplitGroup(group)) finishSplit(m, group, attempt);
  else if (report.verdict === 'done') finishStep(m, group, attempt, report);
  else if (report.verdict === 'rejected') rejectedStep(m, group, attempt, report.feedback ?? '');
  else askFromReport(group, attempt, report);
}

/** `done` of an ordinary step: on to the next one, or first to a review by a person. */
function finishStep(m: Ctx, group: Group, attempt: Attempt, report: Report): void {
  const step = stepsOf(m.state.run, group)[attempt.stepIndex];
  if (step?.humanReview && !attempt.input.reviewed) {
    askHuman(
      group,
      attempt.stepIndex,
      reviewQuestion(attemptStepLabel(m.state, group, attempt), report.summary),
      null,
      'review',
    );
    return;
  }
  advanceStep(m, group, attempt.stepIndex);
}

function finishSplit(m: Ctx, split: Group, attempt: Attempt): void {
  const proposal = attempt.proposal;
  if (!proposal || proposal.length === 0) {
    attempt.status = 'failed';
    attempt.reason = { kind: 'no_groups' };
    failGroup(m, split, { kind: 'no_groups' });
    return;
  }
  const slugs = groupSlugs(proposal.map((group) => group.title));
  m.state.groups = proposal.map((group, index) =>
    newGroup(slugs[index] ?? `group-${index + 1}`, group.title, group.task, index),
  );
  split.status = 'merged';
  split.pending = null;
  // The groups wait in `queued` for the actions after the split.
  enterPoint(m.state, 'after_split');
}

/** A specialist reported on its pipeline action. */
function finishAction(group: Group, attempt: Attempt, report: Report): void {
  if (report.verdict === 'done') {
    group.status = 'merged';
    group.pending = null;
    group.reason = null;
    return;
  }
  if (report.verdict === 'rejected') {
    const detail = (report.feedback ?? report.summary).trim();
    restorePending(group);
    group.status = 'failed';
    group.reason = `reported rejected${detail ? `: ${detail.split('\n')[0]}` : ''}`;
    return;
  }
  askFromReport(group, attempt, report);
}

function finishResolve(m: Ctx, group: Group, report: Report): void {
  group.pending = null;
  if (report.verdict === 'done') {
    group.status = 'merged';
    m.effects.push(...resolverDone(m.state));
    return;
  }
  const detail = (report.feedback ?? report.summary).trim();
  group.status = 'failed';
  group.reason = `resolver reported ${report.verdict}`;
  m.effects.push(
    ...finishDelivery(
      m.state,
      {
        kind: 'failed',
        message: `the resolver reported ${report.verdict}${detail ? `: ${detail}` : ''}`,
      },
      m.now,
    ),
  );
}

/** The observer reported. A delivery repair is closed by the delivery that follows `done`. */
function finishRepair(m: Ctx, group: Group, report: Report): void {
  group.pending = null;
  const incident = m.state.run.repair.incident;
  const taken = incident ? [incident.key] : [];
  if (report.verdict === 'done') {
    group.status = 'merged';
    group.reason = null;
    if (m.state.run.pendingDelivery?.repair) {
      m.effects.push(...resolverDone(m.state));
      return;
    }
    closeRepair(m.state, { taken, refund: false });
    return;
  }
  const detail = (report.feedback ?? report.summary).trim();
  group.status = 'failed';
  group.reason = `observer reported ${report.verdict}${detail ? `: ${detail.split('\n')[0]}` : ''}`;
  if (m.state.run.pendingDelivery?.repair) {
    m.effects.push(
      ...finishDelivery(
        m.state,
        {
          kind: 'failed',
          message: `the observer reported ${report.verdict}${detail ? `: ${detail}` : ''}`,
        },
        m.now,
      ),
    );
    return;
  }
  closeRepair(m.state, { taken, refund: false });
}
