import {
  findingsText,
  freshPending,
  openFindings,
  recoveryUsed,
  stagnantRounds,
  stepsOf,
  type Attempt,
  type Group,
} from '../../types/index.ts';
import type { Ctx } from '../events.ts';
import type { Step } from '../../../swarm-config/types/index.ts';

export function finishRecovery(group: Group, attempt: Attempt, steps: Step[]): boolean {
  if (attempt.input.review?.role !== 'recovery') return false;
  const reviewer = steps.find((step) => step.id === attempt.input.review?.reviewerStep);
  if (!reviewer?.onReject) return false;
  group.status = 'queued';
  group.pending = freshPending(steps.findIndex((step) => step.id === reviewer.onReject?.goto));
  return true;
}

/** Handles only opt-in cycles; legacy snapshots retain their former routing. */
export function managedRejection(
  m: Ctx,
  group: Group,
  attempt: Attempt,
  feedback: string,
): boolean {
  const steps = stepsOf(m.state.run, group);
  const reject = steps[attempt.stepIndex]?.onReject;
  const policy = reject?.review;
  if (!reject || !policy) return false;
  const rounds = (group.rejections[attempt.stepId] ?? 0) + 1;
  group.rejections[attempt.stepId] = rounds;
  const target = steps.findIndex((step) => step.id === reject.goto);
  const stagnant = stagnantRounds(group, attempt.stepId) >= policy.stagnantRounds;
  const exhausted = rounds > reject.maxRounds;
  group.pending = { ...freshPending(target), feedback };
  if (!exhausted && !stagnant) {
    group.status = 'queued';
    return true;
  }
  const recovery = policy.recoveryStep
    ? steps.findIndex((step) => step.id === policy.recoveryStep)
    : -1;
  if (!exhausted && recovery >= 0 && !recoveryUsed(group, attempt.stepId)) {
    group.status = 'queued';
    group.pending = { ...freshPending(recovery), feedback, recoveryFor: attempt.stepId };
    return true;
  }
  const reason = exhausted
    ? `review limit exhausted (${rounds} rejections, limit ${reject.maxRounds})`
    : `review stalled for ${policy.stagnantRounds} revisions${recoveryUsed(group, attempt.stepId) ? ' after strategy recovery' : ''}`;
  group.status = 'needs_human';
  group.humanOnly = 'review_cycle';
  group.question = `${reason}. Choose a revised scope, a different implementation strategy or specialist, or explicitly authorize one more attempt. Counters are not reset.\n\n${findingsText(openFindings(group, attempt.stepId))}`;
  group.questions = null;
  group.pending.askedBy = attempt.seq;
  return true;
}
