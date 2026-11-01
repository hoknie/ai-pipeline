import { findSpecialist } from '../config/index.ts';

import { buildInput } from './input.ts';
import type { Effect } from './machine.ts';
import { allGroups, stepsOf, type Attempt, type Group, type RunState } from './model.ts';

export function runningCount(states: RunState[]): number {
  return states.reduce(
    (count, state) =>
      count +
      allGroups(state).reduce(
        (groupCount, group) =>
          groupCount + group.attempts.filter((attempt) => attempt.status === 'running').length,
        0,
      ),
    0,
  );
}

export function runningBySpecialist(states: RunState[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const state of states) {
    for (const group of allGroups(state)) {
      for (const attempt of group.attempts) {
        if (attempt.status !== 'running') continue;
        counts.set(attempt.specialist, (counts.get(attempt.specialist) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export function dispatch(states: RunState[], max: number, now: number): Effect[] {
  const effects: Effect[] = [];
  let running = runningCount(states);
  const bySpecialist = runningBySpecialist(states);
  const queue = states
    .filter((state) => state.run.finishedAt === null)
    .sort(
      (left, right) =>
        left.run.createdAt - right.run.createdAt || left.run.id.localeCompare(right.run.id),
    )
    .flatMap((state) =>
      [...allGroups(state)]
        .sort((left, right) => left.position - right.position)
        .filter((group) => group.status === 'queued' && group.pending !== null)
        .map((group) => ({ state, group })),
    );
  for (const { state, group } of queue) {
    if (running >= max) break;
    const slug = group.pending
      ? stepsOf(state.run, group)[group.pending.stepIndex]?.specialist
      : undefined;
    const limit = slug ? (findSpecialist(state.run.config, slug)?.max ?? null) : null;
    if (slug && limit !== null && (bySpecialist.get(slug) ?? 0) >= limit) continue;
    const attempt = startAttempt(state, group, now);
    bySpecialist.set(attempt.specialist, (bySpecialist.get(attempt.specialist) ?? 0) + 1);
    effects.push({ kind: 'start_attempt', run: state.run.id, group: group.slug, seq: attempt.seq });
    running += 1;
  }
  return effects;
}

function startAttempt(state: RunState, group: Group, now: number): Attempt {
  const pending = group.pending;
  if (pending === null) throw new Error(`group ${group.slug} has nothing to start`);
  const step = stepsOf(state.run, group)[pending.stepIndex];
  if (!step) throw new Error(`step ${pending.stepIndex} does not exist`);
  const specialist = findSpecialist(state.run.config, step.specialist);
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
