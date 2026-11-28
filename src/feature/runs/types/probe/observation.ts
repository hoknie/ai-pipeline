import type { Usage } from '../../../agents/types/index.ts';
import { allGroups, isRunFinished, type RunState } from '../run.ts';
import { probeInputKeys } from './probe.ts';
import type { ProbeCheckResult, ProbeObservation, ProbeRun } from './experiment.ts';

/** Tokens every attempt of a run has used so far, live attempts included. */
export function probeTokens(state: RunState): number {
  let tokens = 0;
  for (const group of allGroups(state)) {
    for (const attempt of group.attempts) {
      const usage: Usage | null = attempt.usage ?? null;
      if (usage !== null) tokens += usage.inputTokens + usage.outputTokens;
    }
  }
  return tokens;
}

function countsOf(state: RunState) {
  const verdicts = { done: 0, rejected: 0, needs_human: 0 };
  let denials = 0;
  let outsideChanges = 0;
  for (const group of allGroups(state)) {
    for (const attempt of group.attempts) {
      denials += attempt.denials?.length ?? 0;
      outsideChanges += attempt.outsideChanges?.length ?? 0;
      const verdict = attempt.status === 'finished' ? attempt.report?.verdict : undefined;
      if (verdict !== undefined) verdicts[verdict] += 1;
    }
  }
  return { verdicts, denials, outsideChanges };
}

/**
 * The objective signal of one probe run: the statuses of its groups, the result of the isolated
 * delivery check, the tool calls the runtime refused, the changes outside the worktree and the
 * verdicts. No text of a report is judged here.
 */
export function observeRun(
  run: ProbeRun,
  state: RunState | null,
  check: ProbeCheckResult | null,
  error: string | null = null,
): ProbeObservation {
  const empty = {
    candidate: run.candidate,
    repetition: run.repetition,
    runId: run.runId,
    finished: false,
    groups: 0,
    merged: 0,
    conflicts: null,
    clean: false,
    denials: 0,
    outsideChanges: 0,
    verdicts: { done: 0, rejected: 0, needs_human: 0 },
    tokens: 0,
    error,
    input: null,
  };
  if (state === null || !isRunFinished(state)) return empty;
  const groups = state.groups.length;
  const merged = state.groups.filter((group) => group.status === 'merged').length;
  const conflicts = error === null ? (check?.conflicts.length ?? null) : null;
  const clean = groups > 0 && merged === groups && check?.applied === true && conflicts === 0;
  return {
    ...empty,
    finished: true,
    groups,
    merged,
    conflicts,
    clean,
    ...countsOf(state),
    tokens: probeTokens(state),
    input: probeInputKeys(state),
  };
}
