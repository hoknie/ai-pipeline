import { rejected } from '../../../platform/errors/index.ts';
import { groupPipeline } from '../../swarm-config/types/index.ts';
import {
  type Attempt,
  type FailReason,
  type Group,
  type HumanOnly,
  type HumanQuestion,
  actionPointOf,
  attemptStepLabel,
  checkSkip,
  describeFailReason,
  findGroup,
  freshPending,
  isActionGroup,
  isMessageGroup,
  isRepairGroup,
  isResolveGroup,
  isTerminal,
  nextUnskipped,
  runPipeline,
  stepStates,
  stepsOf,
} from '../types/index.ts';
import { finishDelivery, finishMessage } from './delivery-flow.ts';
import type { ActionOutcome, Ctx, Effect } from './events.ts';
import { closeRepair } from './repair.ts';

export function groupOf(m: Ctx, slug: string): Group {
  const group = findGroup(m.state, slug);
  if (!group) throw rejected(`unknown group \`${slug}\``);
  return group;
}

export function runningAttempt(group: Group, seq: number): Attempt | undefined {
  return group.attempts.find((attempt) => attempt.seq === seq && attempt.status === 'running');
}

export function askHuman(
  group: Group,
  step: number,
  question: string,
  questions: HumanQuestion[] | null,
  humanOnly: HumanOnly | null = null,
): void {
  group.status = 'needs_human';
  group.question = question;
  group.questions = questions;
  group.humanOnly = humanOnly;
  group.pending = { stepIndex: step, feedback: null, humanAnswer: null, resume: true };
}

export function restorePending(group: Group): void {
  const last = group.attempts.at(-1);
  if (group.pending === null && last) {
    group.pending = {
      stepIndex: last.stepIndex,
      feedback: last.input.feedback,
      humanAnswer: last.input.humanAnswer,
      resume: false,
      ...(last.input.reviewed ? { reviewed: true } : {}),
    };
  }
}

/** The group waits in `queued` for the same step; the scheduler holds it until the limit resets. */
export function waitForLimit(group: Group, attempt: Attempt): void {
  if (isTerminal(group.status)) return;
  group.pending = {
    stepIndex: attempt.stepIndex,
    feedback: attempt.input.feedback,
    humanAnswer: attempt.input.humanAnswer,
    resume: attempt.sessionId !== null,
    ...(attempt.input.reviewed ? { reviewed: true } : {}),
  };
  group.status = 'queued';
  group.reason = null;
}

export function enqueueMerge(m: Ctx, group: Group, updateOnConflict: boolean): void {
  group.status = 'merging';
  group.pending = null;
  group.mergeSeq = m.state.run.nextMergeSeq;
  m.state.run.nextMergeSeq += 1;
  group.mergeInFlight = false;
  group.updateOnConflict = updateOnConflict;
}

export function advanceStep(m: Ctx, group: Group, current: number): void {
  const next = current + 1;
  if (next < stepsOf(m.state.run, group).length) {
    group.status = 'queued';
    group.pending = freshPending(next);
  } else {
    enqueueMerge(m, group, false);
  }
}

export function rejectedStep(m: Ctx, group: Group, attempt: Attempt, feedback: string): void {
  const steps = stepsOf(m.state.run, group);
  const onReject = steps[attempt.stepIndex]?.onReject ?? null;
  if (onReject === null) {
    askHuman(group, attempt.stepIndex, feedback, null);
    return;
  }
  const rounds = (group.rejections[attempt.stepId] ?? 0) + 1;
  const gotoIndex = steps.findIndex((step) => step.id === onReject.goto);
  group.rejections[attempt.stepId] = rounds;
  if (rounds > onReject.maxRounds) {
    // The answer goes to the goto step with the feedback: the rejecting step would only reject.
    askHuman(
      group,
      gotoIndex,
      `Step \`${attemptStepLabel(m.state, group, attempt)}\` rejected the work ${rounds} times (limit ${onReject.maxRounds}). Last feedback:\n${feedback}`,
      null,
    );
    group.pending = { ...freshPending(gotoIndex), feedback, askedBy: attempt.seq };
    return;
  }
  group.status = 'queued';
  group.pending = {
    stepIndex: gotoIndex,
    feedback,
    humanAnswer: null,
    resume: false,
  };
}

export function finishMessageGroup(m: Ctx, group: Group, summary: string | null): void {
  if (summary !== null) {
    group.status = 'merged';
    group.pending = null;
  }
  m.effects.push(...finishMessage(m.state, summary));
}

export function failGroup(m: Ctx, group: Group, reason: FailReason): void {
  if (isTerminal(group.status)) return;
  restorePending(group);
  group.status = 'failed';
  group.reason = describeFailReason(reason);
  if (isMessageGroup(group)) finishMessageGroup(m, group, null);
  if (isRepairGroup(group)) {
    // A crash, a timeout or an interruption: the incident is taken again; a usage limit gives
    // the repair back and does not wait.
    group.pending = null;
    closeRepair(m.state, { taken: [], refund: reason.kind === 'usage_limit' });
  }
  if (isResolveGroup(group)) {
    group.pending = null;
    m.effects.push(
      ...finishDelivery(
        m.state,
        { kind: 'failed', message: `the resolver failed: ${describeFailReason(reason)}` },
        m.now,
      ),
    );
  }
}

/** The attempt stopped because of a human message: the step goes on in the same session. */
export function continueAfterMessage(
  m: Ctx,
  group: Group,
  attempt: Attempt,
  reason: { text: string; at: number },
): void {
  attempt.status = 'cancelled';
  attempt.finishedAt ??= m.now;
  group.pending = {
    ...freshPending(attempt.stepIndex),
    resume: true,
    message: { text: reason.text, at: reason.at },
    ...(attempt.input.reviewed ? { reviewed: true } : {}),
  };
  group.status = 'queued';
}

/** The attempt stopped because of a pause: the step goes on in the same session. */
export function continueAfterPause(m: Ctx, group: Group, attempt: Attempt): void {
  attempt.status = 'cancelled';
  attempt.finishedAt ??= m.now;
  waitForLimit(group, attempt);
}

function skipRunning(m: Ctx, group: Group, running: Attempt, index: number): void {
  running.status = 'cancelled';
  running.reason = { kind: 'skipped' };
  running.finishedAt = m.now;
  m.effects.push({
    kind: 'stop_attempt',
    run: m.state.run.id,
    group: group.slug,
    seq: running.seq,
  });
  group.status = 'queued';
  group.pending = {
    stepIndex: index,
    feedback: running.input.feedback,
    humanAnswer: null,
    resume: false,
  };
}

export function stepSkip(m: Ctx, step: string, skip: boolean): void {
  const { run } = m.state;
  const steps = groupPipeline(run.config, runPipeline(run)).steps;
  const index = steps.findIndex((candidate) => candidate.id === step);
  if (index === -1) {
    throw rejected(
      `unknown step \`${step}\`; steps: ${steps.map((candidate) => candidate.id).join(', ')}`,
    );
  }
  if (stepStates(m.state)[index]?.state === 'done') {
    throw rejected(`step \`${step}\` is already passed by every group`);
  }
  const current = run.skippedSteps.includes(step);
  if (skip === current) return;
  const wanted = skip
    ? [...run.skippedSteps, step]
    : run.skippedSteps.filter((item) => item !== step);
  if (skip) {
    const error = checkSkip(run.config, run.pipeline, wanted);
    if (error !== null) throw rejected(error);
  }
  run.skippedSteps = steps.map((item) => item.id).filter((id) => wanted.includes(id));
  if (!skip) return;
  for (const group of m.state.groups) {
    const running = group.attempts.find(
      (attempt) => attempt.status === 'running' && attempt.stepIndex === index,
    );
    if (running) {
      skipRunning(m, group, running, index);
    } else if (group.status === 'needs_human' && group.pending?.stepIndex === index) {
      group.status = 'queued';
      group.question = null;
      group.questions = null;
      group.humanOnly = null;
      group.pending = { ...group.pending, humanAnswer: null, resume: false };
    }
  }
}

/** A queued group never waits on a skipped step: it moves on, or goes to the merge. */
export function skipAhead(m: Ctx): void {
  const { run } = m.state;
  if (run.skippedSteps.length === 0) return;
  for (const group of m.state.groups) {
    if (group.status !== 'queued' || group.pending === null) continue;
    const step = stepsOf(run, group)[group.pending.stepIndex];
    if (!step || !run.skippedSteps.includes(step.id)) continue;
    const next = nextUnskipped(run, group, group.pending.stepIndex + 1);
    if (next === null) {
      enqueueMerge(m, group, false);
    } else {
      group.pending = {
        stepIndex: next,
        feedback: group.pending.feedback,
        humanAnswer: null,
        resume: false,
      };
    }
  }
}

export function commitEffect(m: Ctx, group: Group, attempt: Attempt, summary: string): Effect {
  return {
    kind: 'commit',
    run: m.state.run.id,
    group: group.slug,
    stepId: attempt.stepId,
    summary,
  };
}

/** A command action ended; the daemon says how. */
export function actionFinished(m: Ctx, slug: string, seq: number, outcome: ActionOutcome): void {
  const group = groupOf(m, slug);
  const attempt = runningAttempt(group, seq);
  if (!attempt) return;
  attempt.finishedAt = m.now;
  if (outcome.kind === 'exit' && outcome.code === 0) {
    attempt.status = 'finished';
    attempt.report = { verdict: 'done', summary: 'exit code 0', feedback: null };
    group.status = 'merged';
    group.pending = null;
    group.reason = null;
    const point = actionPointOf(group);
    if (point === 'before_split' || point === 'after_split') {
      m.effects.push(commitEffect(m, group, attempt, `action ${attempt.stepId}`));
    }
    return;
  }
  const reason: FailReason =
    outcome.kind === 'exit'
      ? { kind: 'exit_code', code: outcome.code }
      : outcome.kind === 'timeout'
        ? { kind: 'timeout' }
        : { kind: 'spawn', message: outcome.message };
  attempt.status = 'failed';
  attempt.reason = reason;
  failGroup(m, group, reason);
}

/** The commit of a step failed. The group of an action is merged by then: it fails, and the pipeline waits. */
export function commitFailed(m: Ctx, slug: string, message: string): void {
  const group = groupOf(m, slug);
  if (!isActionGroup(group)) {
    failGroup(m, group, { kind: 'git', message });
    return;
  }
  group.status = 'failed';
  group.reason = describeFailReason({ kind: 'git', message });
  group.pending = freshPending(0);
}

export function timedOut(m: Ctx, slug: string, seq: number): void {
  const group = groupOf(m, slug);
  const attempt = runningAttempt(group, seq);
  if (!attempt || attempt.reason?.kind === 'message' || attempt.reason?.kind === 'paused') {
    return;
  }
  attempt.status = 'failed';
  attempt.reason = { kind: 'timeout' };
  attempt.finishedAt = m.now;
  m.effects.push({ kind: 'stop_attempt', run: m.state.run.id, group: slug, seq });
  failGroup(m, group, { kind: 'timeout' });
}
