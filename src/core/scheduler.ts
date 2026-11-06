import { buildInput } from './input.ts';
import type { Effect } from './machine.ts';
import {
  COMMAND_RUNTIME,
  USAGE_LIMIT_FALLBACK_MS,
  actionOf,
  allGroups,
  isRepairGroup,
  specialistOfStep,
  stepsOf,
  type Attempt,
  type Group,
  type RunState,
} from './model.ts';
import { isCommandAction, planDispatch } from './plan.ts';

/** When the usage limit of an attempt that ran out of it resets; null for other attempts. */
export function limitResetsAt(attempt: Attempt): number | null {
  if (attempt.reason?.kind !== 'usage_limit') return null;
  return (
    attempt.reason.resetsAt ?? (attempt.finishedAt ?? attempt.startedAt) + USAGE_LIMIT_FALLBACK_MS
  );
}

/** Runtimes held by a usage limit that has not reset at `now`, with the moment it resets. */
export function limitHolds(states: Iterable<RunState>, now: number): Map<string, number> {
  const holds = new Map<string, number>();
  for (const state of states) {
    for (const group of allGroups(state)) {
      for (const attempt of group.attempts) {
        const until = limitResetsAt(attempt);
        if (until === null || until <= now) continue;
        holds.set(attempt.runtime, Math.max(holds.get(attempt.runtime) ?? 0, until));
      }
    }
  }
  return holds;
}

/** Running attempts of each repository. */
export function runningByRepository(states: RunState[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const state of states) {
    const running = allGroups(state).reduce(
      (count, group) =>
        count +
        (isRepairGroup(group) ? [] : group.attempts).filter(
          (attempt) => attempt.status === 'running' && attempt.runtime !== COMMAND_RUNTIME,
        ).length,
      0,
    );
    const repository = state.run.repository;
    counts.set(repository, (counts.get(repository) ?? 0) + running);
  }
  return counts;
}

/** `swarm.max` of each repository: the value of its most recently created run. */
export function repositoryLimits(states: RunState[]): Map<string, number> {
  const latest = new Map<string, RunState>();
  for (const state of states) {
    const current = latest.get(state.run.repository);
    if (
      !current ||
      state.run.createdAt > current.run.createdAt ||
      (state.run.createdAt === current.run.createdAt && state.run.id > current.run.id)
    )
      latest.set(state.run.repository, state);
  }
  return new Map([...latest].map(([repository, state]) => [repository, state.run.config.max]));
}

export function runningBySpecialist(states: RunState[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const state of states) {
    for (const group of allGroups(state)) {
      if (isRepairGroup(group)) continue;
      for (const attempt of group.attempts) {
        if (attempt.status !== 'running' || attempt.runtime === COMMAND_RUNTIME) continue;
        counts.set(attempt.specialist, (counts.get(attempt.specialist) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export function dispatch(states: RunState[], now: number): Effect[] {
  return planDispatch(states, now).start.map(({ state, group }) => {
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
  const resumeSession = pending.resume ? (previousOfStep.at(-1)?.sessionId ?? null) : null;
  const attempt: Attempt = {
    seq: (group.attempts.at(-1)?.seq ?? 0) + 1,
    stepId: step.id,
    stepIndex: pending.stepIndex,
    round: previousOfStep.length + 1,
    specialist: specialist.slug,
    runtime: specialist.runtime,
    model: specialist.model,
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
