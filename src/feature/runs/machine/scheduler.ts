import {
  type Attempt,
  type DispatchLimit,
  type Group,
  type RunState,
  COMMAND_RUNTIME,
  actionOf,
  buildInput,
  REPOSITORY_LIMIT,
  type SelectedRuntime,
  specialistOfStep,
  stepsOf,
} from '../types/index.ts';
import { keepsConversation } from '../../swarm-config/types/index.ts';
import { OFF_NETWORK, type NetworkSnapshot } from '../../network/types/index.ts';
import type { Effect } from './events.ts';
import { isCommandAction, planDispatch } from './plan.ts';

export function dispatch(
  states: RunState[],
  now: number,
  network: NetworkSnapshot = OFF_NETWORK,
  limit: DispatchLimit = REPOSITORY_LIMIT,
): Effect[] {
  return planDispatch(states, now, network, limit).start.map(({ state, group, selected }) => {
    const attempt = isCommandAction(state, group)
      ? startCommand(state, group, now)
      : startAttempt(state, group, now, selected);
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
    generation: null,
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

/** Starts the attempt on the runtime and model the plan chose, so the pool it counted is the pool it takes. */
function startAttempt(
  state: RunState,
  group: Group,
  now: number,
  selected: SelectedRuntime | undefined,
): Attempt {
  const pending = group.pending;
  if (pending === null) throw new Error(`group ${group.slug} has nothing to start`);
  const step = stepsOf(state.run, group)[pending.stepIndex];
  if (!step) throw new Error(`step ${pending.stepIndex} does not exist`);
  const specialist = specialistOfStep(state.run, group, step);
  if (!specialist) throw new Error(`specialist ${step.specialist} does not exist`);
  const previousOfStep = group.attempts.filter((attempt) => attempt.stepId === step.id);
  if (!selected) throw new Error(`group ${group.slug} has no runtime chosen`);
  const seq = (group.attempts.at(-1)?.seq ?? 0) + 1;
  const { generation, resumeSession } = conversationOf(
    previousOfStep,
    pending.resume,
    selected.runtime,
    seq,
  );
  const attempt: Attempt = {
    seq,
    stepId: step.id,
    stepIndex: pending.stepIndex,
    round: previousOfStep.length + 1,
    specialist: specialist.slug,
    runtime: selected.runtime,
    model: selected.model,
    generation,
    ...(selected.variant !== undefined ? { variant: selected.variant } : {}),
    ...(selected.reasoningEffort !== undefined
      ? { reasoningEffort: selected.reasoningEffort }
      : {}),
    ...(selected.chainIndex !== undefined && selected.chainIndex !== null
      ? { chainIndex: selected.chainIndex }
      : {}),
    ...(selected.provider !== undefined ? { provider: selected.provider } : {}),
    ...(selected.requestedProvider !== undefined
      ? { requestedProvider: selected.requestedProvider }
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

/**
 * The conversation of a new attempt. A CLI with its own history inherits the generation and the exact
 * session of the last attempt of the step only on a resume on the same runtime; otherwise the attempt
 * opens a generation of its own (`seq`), so no id or private state crosses a runtime or a retry.
 * The other runtimes keep `generation = null` and the session of any earlier attempt.
 */
function conversationOf(
  previousOfStep: Attempt[],
  resume: boolean,
  runtime: string,
  seq: number,
): { generation: number | null; resumeSession: string | null } {
  const sessionOf = (attempt: Attempt): string | null => attempt.sessionId ?? attempt.resumeSession;
  if (keepsConversation(runtime)) {
    const last = previousOfStep.at(-1);
    if (resume && last && last.runtime === runtime && last.generation !== null) {
      return { generation: last.generation, resumeSession: sessionOf(last) };
    }
    return { generation: seq, resumeSession: null };
  }
  if (!resume) return { generation: null, resumeSession: null };
  const usable = previousOfStep.filter((attempt) => !keepsConversation(attempt.runtime));
  const resumeSession =
    usable.findLast((attempt) => sessionOf(attempt) !== null)?.sessionId ??
    usable.findLast((attempt) => attempt.resumeSession !== null)?.resumeSession ??
    null;
  return { generation: null, resumeSession };
}
