import { suggestPatterns } from '../../../feature/agents/types/index.ts';
import {
  type Attempt,
  type Group,
  type RunState,
  actionPointOf,
  attemptStepLabel,
  attemptVerdict,
  describeFailReason,
  groupRef,
  groupUsage,
  isServiceGroup,
  isSplitGroup,
} from '../../../feature/runs/types/index.ts';
import type {
  AttemptDecision,
  AttemptView,
  GroupView,
  SpecCandidate,
} from '../contract/responses/groups.ts';
import type { DiffStat, WaitLookup } from '../contract/responses/runs.ts';
import {
  NO_WAITS,
  displayStatus,
  duration,
  groupHold,
  groupLimitUntil,
  legacyOutsideChanges,
  serviceStatus,
} from './rows.ts';

/**
 * The answer given to the question of an attempt: a decision that records the number of the
 * asking attempt belongs to that attempt; decisions without a number (older runs) are matched
 * by order — the N-th one of a step to the N-th needs_human attempt of that step not claimed
 * by a numbered decision.
 */
function attemptDecision(group: Group, attempt: Attempt): AttemptDecision | null {
  const numbered = group.decisions.find((d) => d.attemptSeq === attempt.seq);
  if (numbered) {
    return { question: numbered.question, answer: numbered.answer, by: numbered.by };
  }
  if (attempt.status !== 'finished' || attempt.report?.verdict !== 'needs_human') return null;
  const claimed = new Set(group.decisions.map((d) => d.attemptSeq));
  const asked = group.attempts.filter(
    (candidate) =>
      candidate.stepId === attempt.stepId &&
      candidate.status === 'finished' &&
      candidate.report?.verdict === 'needs_human' &&
      !claimed.has(candidate.seq),
  );
  const decision = group.decisions.filter(
    (d) => d.stepId === attempt.stepId && d.attemptSeq === undefined,
  )[asked.indexOf(attempt)];
  return decision
    ? { question: decision.question, answer: decision.answer, by: decision.by }
    : null;
}

export function attemptView(
  state: RunState,
  group: Group,
  attempt: Attempt,
  now: number,
  allowCommands: readonly string[] = [],
): AttemptView {
  return {
    seq: attempt.seq,
    stepId: attempt.stepId,
    stepName: attemptStepLabel(state, group, attempt),
    round: attempt.round,
    specialist: attempt.specialist,
    runtime: attempt.runtime,
    model: attempt.model,
    status: attempt.status,
    verdict: attemptVerdict(attempt),
    summary: attempt.report?.summary ?? null,
    feedback: attempt.report?.feedback ?? null,
    decision: attemptDecision(group, attempt),
    reason: attempt.reason ? describeFailReason(attempt.reason) : null,
    startedAt: attempt.startedAt,
    durationMs: duration(attempt.startedAt, attempt.finishedAt, now),
    usage: attempt.usage,
    denials: attempt.denials.map((denial) => ({
      tool: denial.tool,
      command: denial.command,
      suggestions: denial.command === null ? [] : suggestPatterns(denial.command, allowCommands),
    })),
    outsideChanges: [...attempt.outsideChanges],
    message: attempt.input.message ? { ...attempt.input.message } : null,
    interrupting:
      attempt.status === 'running' &&
      (attempt.reason?.kind === 'message' || attempt.reason?.kind === 'paused'),
  };
}

function allowCommandsOf(state: RunState, specialist: string): string[] {
  return (
    state.run.config.specialists.find((candidate) => candidate.slug === specialist)
      ?.allowCommands ?? []
  );
}

export function permissionHints(attempts: AttemptView[]): string[] {
  const hints = new Set<string>();
  for (const attempt of attempts) {
    for (const denial of attempt.denials) {
      for (const suggestion of denial.suggestions) {
        if (suggestion.pattern !== null) hints.add(suggestion.pattern);
      }
    }
  }
  return [...hints];
}

export function groupView(
  state: RunState,
  group: Group,
  worktree: string,
  log: { seq: number; lines: string[] } | null,
  now: number,
  diff: DiffStat | null = null,
  waits: WaitLookup = NO_WAITS,
): GroupView {
  const wait = group.status === 'queued' ? waits(state.run.id, group.slug) : null;
  const legacy = legacyOutsideChanges(group);
  const attempts = group.attempts.map((attempt) => {
    const view = attemptView(
      state,
      group,
      attempt,
      now,
      allowCommandsOf(state, attempt.specialist),
    );
    const restored = legacy.outside.get(attempt.seq);
    return restored ? { ...view, outsideChanges: restored } : view;
  });
  return {
    runId: state.run.id,
    slug: group.slug,
    title: group.title,
    task: group.task,
    status: displayStatus(
      isServiceGroup(group) ? serviceStatus(group) : group.status,
      wait,
      groupHold(state, group),
    ),
    wait: groupHold(state, group) === null ? wait : null,
    branch:
      isSplitGroup(group) || actionPointOf(group) !== undefined
        ? state.run.branch
        : groupRef(state.run, group.slug),
    worktree,
    question: group.question,
    questions: group.questions,
    humanOnly: group.humanOnly,
    decisions: group.decisions.map((decision) => ({ ...decision })),
    reason: group.reason,
    limitUntil: groupLimitUntil(group),
    warnings: legacy.warnings,
    conflictFiles: [...group.conflictFiles],
    delivery: {
      ...group.delivery,
      files: [...group.delivery.files],
      conflicts: [...group.delivery.conflicts],
      userEdits: [...group.delivery.userEdits],
    },
    usage: groupUsage(group),
    diff,
    attempts,
    permissionHints: permissionHints(attempts),
    log,
  };
}

const SPEC_PATH = /^openspec\/changes\/(archive\/[^/]+|[^/]+)\/(?:proposal|design|tasks)\.md$/;

/** The changes among `paths`, active before archived and then by name. */
export function pickSpecChange(paths: string[]): SpecCandidate[] {
  const found = new Map<string, SpecCandidate>();
  for (const path of paths) {
    const directory = SPEC_PATH.exec(path)?.[1];
    if (directory === undefined || found.has(directory)) continue;
    found.set(directory, {
      change: directory.slice(directory.lastIndexOf('/') + 1),
      path: `openspec/changes/${directory}`,
    });
  }
  const archived = (candidate: SpecCandidate) => candidate.path.includes('/changes/archive/');
  return [...found.values()].sort(
    (a, b) =>
      Number(archived(a)) - Number(archived(b)) ||
      (a.change < b.change ? -1 : a.change > b.change ? 1 : 0),
  );
}
