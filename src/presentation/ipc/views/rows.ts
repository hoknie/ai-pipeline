import {
  type Group,
  type GroupStatus,
  type GroupWait,
  type RunHold,
  type RunState,
  actionGroupsOf,
  actionPointOf,
  attemptStepLabel,
  groupUsage,
  limitResetsAt,
  parseActionSlug,
} from '../../../feature/runs/types/index.ts';
import type { ActionPoint } from '../../../feature/swarm-config/types/index.ts';
import type {
  ArtifactCounts,
  DiffLookup,
  DiffStat,
  DiffTotals,
  GroupRow,
  SystemStepKind,
  SystemStepRow,
  WaitLookup,
} from '../contract/responses/runs.ts';

export const NO_DIFFS: DiffLookup = () => null;

function totals(diff: DiffStat | null): DiffTotals | null {
  return diff ? { files: diff.files.length, added: diff.added, removed: diff.removed } : null;
}

export const NO_WAITS: WaitLookup = () => null;

export const NO_ARTIFACTS: ArtifactCounts = new Map();

/**
 * `frozen`/`paused` for a queued group of a held run, `waiting` for a queued group that the
 * scheduler does not take; the stored status otherwise.
 */
export function displayStatus<S extends GroupStatus | 'done'>(
  status: S,
  wait: GroupWait | null,
): S | 'waiting';

export function displayStatus<S extends GroupStatus | 'done'>(
  status: S,
  wait: GroupWait | null,
  hold: RunHold | null,
): S | 'waiting' | RunHold;

export function displayStatus<S extends GroupStatus | 'done'>(
  status: S,
  wait: GroupWait | null,
  hold: RunHold | null = null,
): S | 'waiting' | RunHold {
  if (status !== 'queued') return status;
  return hold ?? (wait !== null ? 'waiting' : status);
}

/** Hold that applies to a group: delivery steps (commit message, resolver) run despite it. */
export function groupHold(state: RunState, group: Group): RunHold | null {
  const point = actionPointOf(group);
  if (point === 'before_delivery' || point === 'after_delivery') return null;
  return group === state.message || group === state.resolve ? null : state.run.hold;
}

export function duration(start: number, end: number | null, now: number): number {
  return Math.max(0, (end ?? now) - start);
}

function groupDuration(group: Group, now: number): number {
  const first = group.attempts[0];
  const last = group.attempts.at(-1);
  if (!first || !last) return 0;
  return duration(first.startedAt, last.finishedAt, now);
}

const LEGACY_OUTSIDE = /^step (\S+) changed files outside its worktree: (.+)$/;

/**
 * Runs recorded before attempts kept their files outside the worktree have them as warning text.
 * Each such warning goes back to the latest attempt of its step whose list is still empty; later
 * warnings take later attempts. A warning without such an attempt stays a warning.
 */
export function legacyOutsideChanges(group: Group): {
  warnings: string[];
  outside: Map<number, string[]>;
} {
  const outside = new Map<number, string[]>();
  const kept: string[] = [];
  for (const warning of [...group.warnings].reverse()) {
    const match = LEGACY_OUTSIDE.exec(warning);
    const target = match
      ? group.attempts.findLast(
          (attempt) =>
            attempt.stepId === match[1] &&
            attempt.outsideChanges.length === 0 &&
            !outside.has(attempt.seq),
        )
      : undefined;
    if (match && target) outside.set(target.seq, (match[2] as string).split(', '));
    else kept.unshift(warning);
  }
  return { warnings: kept, outside };
}

/** When a group waiting for a usage limit to reset may start again; null for other groups. */
export function groupLimitUntil(group: Group): number | null {
  const last = group.attempts.at(-1);
  return group.status === 'queued' && last ? limitResetsAt(last) : null;
}

export function isHold(status: unknown): status is RunHold {
  return status === 'frozen' || status === 'paused';
}

export function groupRow(
  state: RunState,
  group: Group,
  now: number,
  diffs: DiffLookup = NO_DIFFS,
  wait: GroupWait | null = null,
  artifacts: ArtifactCounts = NO_ARTIFACTS,
): GroupRow {
  const legacy = legacyOutsideChanges(group);
  const last = group.attempts.at(-1);
  const hold = groupHold(state, group);
  return {
    slug: group.slug,
    title: group.title,
    status: displayStatus(group.status, wait, hold),
    wait: group.status === 'queued' && hold === null ? wait : null,
    hold,
    step: last?.stepId ?? null,
    stepName: last ? attemptStepLabel(state, group, last) : null,
    round: last?.round ?? null,
    durationMs: groupDuration(group, now),
    question: group.question,
    questions: group.questions,
    humanOnly: group.humanOnly,
    reason: group.reason,
    warnings:
      legacy.warnings.length +
      group.attempts.filter(
        (attempt) => attempt.outsideChanges.length > 0 || legacy.outside.has(attempt.seq),
      ).length,
    delivery: group.delivery.state,
    diff: totals(diffs(group.slug)),
    diffRevision: diffs(group.slug)?.revision ?? null,
    limitUntil: groupLimitUntil(group),
    usage: groupUsage(group),
    decisions: group.decisions.map((decision) => ({ ...decision })),
    artifacts: artifacts.get(group.slug)?.count ?? 0,
    artifactsRevision: artifacts.get(group.slug)?.revision ?? 0,
  };
}

export function serviceStatus(group: Group): GroupStatus | 'done' {
  return group.status === 'merged' ? 'done' : group.status;
}

export function systemRow(
  state: RunState,
  group: Group,
  kind: SystemStepKind,
  now: number,
  wait: GroupWait | null = null,
  artifacts: ArtifactCounts = NO_ARTIFACTS,
): SystemStepRow {
  const ref = kind === 'action' ? parseActionSlug(group.slug) : null;
  return {
    ...groupRow(state, group, now, NO_DIFFS, wait, artifacts),
    kind,
    status: displayStatus(serviceStatus(group), wait, groupHold(state, group)),
    ...(ref ? { point: ref.point, action: ref.id } : {}),
  };
}

/** The service steps of a run in the order they run: actions around the split and the delivery. */
export function systemGroups(state: RunState): { kind: SystemStepKind; group: Group }[] {
  const actions = (point: ActionPoint) =>
    actionGroupsOf(state, point).map((group) => ({ kind: 'action' as const, group }));
  return [
    ...actions('before_split'),
    ...(state.split ? [{ kind: 'split' as const, group: state.split }] : []),
    ...actions('after_split'),
    ...actions('before_delivery'),
    ...(state.message ? [{ kind: 'message' as const, group: state.message }] : []),
    ...(state.resolve ? [{ kind: 'resolve' as const, group: state.resolve }] : []),
    ...(state.repair ? [{ kind: 'repair' as const, group: state.repair }] : []),
    ...actions('after_delivery'),
  ];
}
