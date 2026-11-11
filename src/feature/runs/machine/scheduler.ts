import {
  type Attempt,
  type Group,
  type RunState,
  COMMAND_RUNTIME,
  actionOf,
  buildInput,
  limitHolds,
  selectAttemptRuntime,
  specialistOfStep,
  stepsOf,
} from '../types/index.ts';
import { OFF_NETWORK, type NetworkSnapshot } from '../../network/types/index.ts';
import type { Effect } from './events.ts';
import { isCommandAction, planDispatch } from './plan.ts';

export function dispatch(
  states: RunState[],
  now: number,
  network: NetworkSnapshot = OFF_NETWORK,
): Effect[] {
  return planDispatch(states, now, network).start.map(({ state, group }) => {
    const attempt = isCommandAction(state, group)
      ? startCommand(state, group, now)
      : startAttempt(state, group, now);
    return {
      kind: attempt.runtime === COMMAND_RUNTIME ? 'run_action' : 'start_attempt',
      run: state.run.id,
      group: group.slug,
      seq: attempt.seq,
    };
  });
}

/** The attempt of a command action: no specialist, no session; the daemon runs `run`. */
function startCommand(state: RunState, group: Group, now: number): Attempt {
  const action = actionOf(state.run, group);
  const pending = group.pending;
  if (!action || action.run === null || pending === null) {
    throw new Error(`group ${group.slug} has no command to run`);
  }
  const step = stepsOf(state.run, group)[0];
  const stepId = step?.id ?? action.id;
  const previous = group.attempts.filter((attempt) => attempt.stepId === stepId);
  const attempt: Attempt = {
    seq: (group.attempts.at(-1)?.seq ?? 0) + 1,
    stepId,
    stepIndex: 0,
    round: previous.length + 1,
    specialist: action.id,
    runtime: COMMAND_RUNTIME,
    model: null,
    status: 'running',
    input: {
      prompt: action.run,
      groupTitle: group.title,
      stepId,
      specialistName: action.name ?? action.id,
      skills: [],
      previous: [],
      feedback: null,
      humanAnswer: null,
      decisions: [],
    },
    resumeSession: null,
    sessionId: null,
    report: null,
    reason: null,
    startedAt: now,
    finishedAt: null,
    usage: null,
    proposal: null,
    denials: [],
    outsideChanges: [],
  };
  group.attempts.push(attempt);
  group.status = 'running';
  group.pending = null;
  return attempt;
}

function startAttempt(state: RunState, group: Group, now: number): Attempt {
  const pending = group.pending;
  if (pending === null) throw new Error(`group ${group.slug} has nothing to start`);
  const step = stepsOf(state.run, group)[pending.stepIndex];
  if (!step) throw new Error(`step ${pending.stepIndex} does not exist`);
  const specialist = specialistOfStep(state.run, group, step.specialist);
  if (!specialist) throw new Error(`specialist ${step.specialist} does not exist`);
  const previousOfStep = group.attempts.filter((attempt) => attempt.stepId === step.id);
  const resumeSession = pending.resume
    ? (previousOfStep.findLast((attempt) => (attempt.sessionId ?? attempt.resumeSession) !== null)
        ?.sessionId ??
      previousOfStep.findLast((attempt) => attempt.resumeSession !== null)?.resumeSession ??
      null)
    : null;
  const holds = limitHolds([state], now);
  const selected = selectAttemptRuntime({
    specialist,
    chains: state.run.config.chains,
    defaults: state.run.config.defaults,
    limitHolds: holds,
    attempts: group.attempts,
    stepIndex: pending.stepIndex,
    round: previousOfStep.length + 1,
    resume: pending.resume,
    keepRuntime: pending.keepRuntime ?? false,
    seed: (group.attempts.at(-1)?.seq ?? 0) + now,
  });
  const attempt: Attempt = {
    seq: (group.attempts.at(-1)?.seq ?? 0) + 1,
    stepId: step.id,
    stepIndex: pending.stepIndex,
    round: previousOfStep.length + 1,
    specialist: specialist.slug,
    runtime: selected.runtime,
    model: selected.model,
    ...(selected.variant !== undefined ? { variant: selected.variant } : {}),
    ...(selected.reasoningEffort !== undefined
      ? { reasoningEffort: selected.reasoningEffort }
      : {}),
    ...(selected.chainIndex !== undefined && selected.chainIndex !== null
      ? { chainIndex: selected.chainIndex }
      : {}),
    status: 'running',
    input: buildInput(state.run, group, pending),
    resumeSession,
    sessionId: null,
    report: null,
    reason: null,
    startedAt: now,
    finishedAt: null,
    usage: null,
    proposal: null,
    denials: [],
    outsideChanges: [],
  };
  group.attempts.push(attempt);
  group.status = 'running';
  group.pending = null;
  return attempt;
}
