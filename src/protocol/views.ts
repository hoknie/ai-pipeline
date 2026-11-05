import { z } from 'zod';

import { workflowNameOf, type DeliveryMode, type SpecialistTagFolder } from '../config/index.ts';
import {
  DEFAULT_AUTOPILOT_ANSWER,
  allGroups,
  attemptVerdict,
  stepProgress,
  type StepProgress,
  describeFailReason,
  deliveryCounts,
  groupRef,
  groupUsage,
  isRunFinished,
  isServiceGroup,
  isSplitGroup,
  isTerminal,
  itemReadiness,
  limitResetsAt,
  dependencyState,
  freezeCandidate,
  knownTags,
  occupiesSlot,
  runPhase,
  runStartedAt,
  suggestPatterns,
  summarize,
  type Attempt,
  type RunHold,
  type Suggestion,
  type DependencyState,
  type Group,
  type ItemReadiness,
  type NewGroup,
  type OnLimit,
  type Queue,
  type QueueItem,
  type QueueStop,
  type ProblemReason,
  runProblems,
  stepsOf,
  type GroupDelivery,
  type HumanDecision,
  type HumanOnly,
  type HumanQuestion,
  type RunPhase,
  type GroupStatus,
  type RunState,
  type Tag,
  type TagColor,
  type Usage,
  topology,
  stepStates,
  stepLabel,
  attemptStepLabel,
  type StepState,
  specialistUse,
  type SpecialistUse,
  type Topology,
  type WorkflowTopology,
  GROUP_STATUSES,
  type GroupWait,
  canReturn,
} from '../core/index.ts';
import type { ConfigEditorView, EntryReference, FieldError } from '../config/index.ts';

/** A catalog tag as clients see it. */
export interface TagView {
  id: string;
  repository: string;
  name: string;
  color: TagColor;
  task: { run: string; number: number } | null;
}

export function tagViews(catalog: readonly Tag[], ids: readonly string[]): TagView[] {
  const byId = new Map(catalog.map((tag) => [tag.id, tag]));
  return knownTags(catalog, ids).flatMap((id) => {
    const tag = byId.get(id);
    return tag
      ? [
          {
            id: tag.id,
            repository: tag.repository,
            name: tag.name,
            color: tag.color,
            task: tag.task,
          },
        ]
      : [];
  });
}

/** The catalog sorted by repository, then by name ignoring case. */
export function catalogView(catalog: readonly Tag[]): TagView[] {
  return [...catalog]
    .sort(
      (a, b) =>
        a.repository.localeCompare(b.repository) ||
        a.name.toLocaleLowerCase('und').localeCompare(b.name.toLocaleLowerCase('und')) ||
        a.id.localeCompare(b.id),
    )
    .map(({ id, repository, name, color, task }) => ({ id, repository, name, color, task }));
}

export interface FileStat {
  path: string;
  /** Added lines; null for a binary file. */
  added: number | null;
  removed: number | null;
  /** Old path of a renamed file. */
  previousPath?: string;
}

export interface DiffStat {
  files: FileStat[];
  added: number;
  removed: number;
}

export interface DiffTotals {
  files: number;
  added: number;
  removed: number;
}

/** Diff statistics of a group by slug, when known. */
export type DiffLookup = (slug: string) => DiffStat | null;

const NO_DIFFS: DiffLookup = () => null;

function totals(diff: DiffStat | null): DiffTotals | null {
  return diff ? { files: diff.files.length, added: diff.added, removed: diff.removed } : null;
}

/** Title of a run: the one it was named with, or the first line of its task. */
export function runTitle(state: RunState): string {
  if (state.run.title) return state.run.title;
  const source =
    state.split?.task ?? (state.groups.length === 1 ? state.groups[0]?.task : undefined);
  const line =
    source
      ?.split('\n')
      .find((part) => part.trim() !== '')
      ?.trim() ?? state.groups.map((group) => group.title).join(', ');
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export type { GroupWait } from '../core/index.ts';

/** Status of a row: the stored one, `done` for a merged service step, or the derived `waiting`. */
export type RowStatus = GroupStatus | 'done' | 'waiting' | RunHold;

/** Why a queued group is not started yet, by run and group slug; null when it is not held back. */
export type WaitLookup = (run: string, slug: string) => GroupWait | null;

const NO_WAITS: WaitLookup = () => null;

/** Number of artifacts per group slug of one run. */
export type ArtifactCounts = ReadonlyMap<string, { count: number; revision: number }>;

const NO_ARTIFACTS: ArtifactCounts = new Map();

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
function groupHold(state: RunState, group: Group): RunHold | null {
  return group === state.message || group === state.resolve ? null : state.run.hold;
}

/**
 * When the clock of a held run stops: the end of its last attempt, once nothing runs, merges
 * or delivers. Null while the run is not held, is finished, still works or has no attempt.
 */
export function clockStoppedAt(state: RunState): number | null {
  if (state.run.hold === null || state.run.finishedAt !== null) return null;
  if (state.run.pendingDelivery !== null) return null;
  const groups = allGroups(state);
  if (groups.some((group) => group.status === 'merging')) return null;
  const attempts = groups.flatMap((group) => group.attempts);
  if (attempts.length === 0 || attempts.some((attempt) => attempt.status === 'running')) {
    return null;
  }
  const ends = attempts
    .map((attempt) => attempt.finishedAt)
    .filter((time): time is number => time !== null);
  return ends.length > 0 ? Math.max(...ends) : null;
}

export interface GroupRow {
  slug: string;
  title: string;
  status: Exclude<RowStatus, 'done'>;
  /** Why the group is `waiting`; null for other statuses. */
  wait: GroupWait | null;
  /** Hold of the run that applies to the group; null: none, or a delivery step. */
  hold: RunHold | null;
  step: string | null;
  /** The human name of `step`; null with `step`. */
  stepName: string | null;
  round: number | null;
  durationMs: number;
  question: string | null;
  questions: HumanQuestion[] | null;
  /** The question is for a person only (the queue autopilot skips it); null: anyone may answer. */
  humanOnly: HumanOnly | null;
  reason: string | null;
  warnings: number;
  delivery: GroupDelivery['state'];
  diff: DiffTotals | null;
  /** The group waits in `queued` until its runtime's usage limit resets (ms); null otherwise. */
  limitUntil: number | null;
  /** Tokens and cost of all attempts of the group so far, live ones included. */
  usage: Usage | null;
  /** Answers accepted for the group, oldest first. */
  decisions: HumanDecision[];
  /** Artifacts the specialists published for the group. */
  artifacts: number;
  /** Changes whenever an artifact of the group is published or replaced. */
  artifactsRevision: number;
}

/** An accepted answer in the overview of a run, with the slug of its group. */
export type RunDecision = HumanDecision & { group: string };

export interface SplitRow {
  status: RowStatus;
  wait: GroupWait | null;
  question: string | null;
  questions: HumanQuestion[] | null;
  humanOnly: HumanOnly | null;
  reason: string | null;
}

export type SystemStepKind = 'split' | 'message' | 'resolve';

/** A service step of the run (split, commit message, delivery resolver). */
export interface SystemStepRow extends Omit<GroupRow, 'status'> {
  kind: SystemStepKind;
  status: RowStatus;
}

/** Delivery of the merged result as the last system stage of a run; derived, not a group. */
export type DeliveryStage =
  | { status: 'pending' }
  | { status: 'delivering' }
  | { status: 'applied'; manual: boolean }
  | { status: 'apply_failed'; reason: string | null; groups: string[] };

/**
 * The state of a run in a view: its phase, `queued` for a finished run waiting as a return
 * item, or the hold (`paused`, `frozen`) of a run the scheduler keeps still.
 */
export type RunViewState = RunPhase | 'queued' | RunHold;

export interface RunView {
  id: string;
  /** Integer number of the task within the repository. */
  number: number;
  title: string;
  /** English kebab-case name; null until the run is named. */
  name: string | null;
  repository: string;
  workflow: string;
  /** Display name of the workflow in the configuration of the run. */
  workflowName: string;
  branch: string;
  createdAt: number;
  /** When the first attempt of any group started; null while the run waits for a free slot. */
  startedAt: number | null;
  finishedAt: number | null;
  finished: boolean;
  state: RunViewState;
  /** Why the scheduler starts no new steps of the run; null: no hold. */
  hold: RunHold | null;
  /**
   * When the clock of the held run stopped (ms): nothing runs, merges or delivers. Null when
   * the clock runs.
   */
  clockStoppedAt: number | null;
  /** Groups waiting for a human answer. */
  waiting: number;
  dirtyWarning: boolean;
  /** Whether the run is delivered automatically once it is merged. */
  autoDeliver: boolean;
  /** How the merged result is delivered. */
  deliveryMode: DeliveryMode;
  /** Created by a task queue. */
  fromQueue: boolean;
  /** The run can go back to its queue: it has failed or cancelled groups and is not in the queue. */
  returnable: boolean;
  /** Id of the queue item that retries the run when taken; null when the run has none. */
  queueItem: string | null;
  tags: TagView[];
  counts: string;
  total: number;
  /** Steps passed by the work groups out of all their steps; `total` is 0 while the task is split. */
  progress: { done: number; total: number };
  usage: Usage | null;
  split: SplitRow | null;
  delivery: {
    applied: number;
    merged: number;
    failed: number;
    inProgress: boolean;
    /** When the last delivery attempt of the merged groups ended (ms); null before the first. */
    finishedAt: number | null;
  };
  resolver: ResolverRow | null;
  /** Delivery as a system stage; null while nothing is merged and nothing is delivered. */
  deliveryStage: DeliveryStage | null;
  /** Totals over the merged groups. */
  diff: DiffTotals | null;
  /**
   * Changes of all working groups except cancelled ones whose statistics are known; a file
   * shared by several groups counts once. Null when no group has statistics yet.
   */
  liveDiff: DiffTotals | null;
  /** Steps of the workflow with the groups on them, for the topology view. */
  topology: Topology;
  /** Each step of the group workflow: passed, under way or ahead, and whether it is skipped. */
  steps: StepState[];
  /** Specialists that run or are waited for in the run, for the load across the machine. */
  specialists: SpecialistUse[];
  groups: GroupRow[];
  /** Service steps in the order split, message, resolve; absent steps are left out. */
  system: SystemStepRow[];
  /** Answers accepted in the run (human and autopilot): split, work groups, message, resolve. */
  decisions: RunDecision[];
}

export interface ResolverRow {
  status: GroupStatus | 'waiting';
  wait: GroupWait | null;
  round: number;
  rounds: number;
  conflicts: string[];
  reason: string | null;
}

export interface AttemptDecision {
  question: string;
  answer: string;
  by: 'human' | 'autopilot';
}

export interface AttemptView {
  seq: number;
  stepId: string;
  /** The human name of the step. */
  stepName: string;
  round: number;
  specialist: string;
  runtime: string;
  model: string | null;
  status: string;
  verdict: string | null;
  summary: string | null;
  feedback: string | null;
  /** The accepted answer to the question this attempt asked (verdict needs_human), if any. */
  decision: AttemptDecision | null;
  reason: string | null;
  startedAt: number;
  durationMs: number;
  usage: Usage | null;
  /** Tool calls the agent CLI refused, with allow_commands patterns that would let them run. */
  denials: DenialView[];
  /** Files the attempt changed outside its worktree. */
  outsideChanges: string[];
  /** The message the human sent to the specialist before this attempt continued its session. */
  message: { text: string; at: number } | null;
  /** A human message or a pause is stopping this running attempt. */
  interrupting: boolean;
}

export interface DenialView {
  tool: string;
  command: string | null;
  /** Parts of the command that no current allow_commands pattern covers. */
  suggestions: Suggestion[];
}

export interface GroupView {
  runId: string;
  slug: string;
  title: string;
  task: string;
  status: RowStatus;
  /** Why the group is `waiting`; null for other statuses. */
  wait: GroupWait | null;
  branch: string;
  worktree: string;
  question: string | null;
  questions: HumanQuestion[] | null;
  humanOnly: HumanOnly | null;
  /** Accepted answers to the questions of the group, a person's and the autopilot's, oldest first. */
  decisions: HumanDecision[];
  reason: string | null;
  /** The group waits in `queued` until its runtime's usage limit resets (ms); null otherwise. */
  limitUntil: number | null;
  warnings: string[];
  conflictFiles: string[];
  delivery: GroupDelivery;
  usage: Usage | null;
  diff: DiffStat | null;
  attempts: AttemptView[];
  /** Patterns to add to allow_commands for the refused commands of the group, each once. */
  permissionHints: string[];
  log: { seq: number; lines: string[] } | null;
}

function duration(start: number, end: number | null, now: number): number {
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

function isHold(status: unknown): status is RunHold {
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
    limitUntil: groupLimitUntil(group),
    usage: groupUsage(group),
    decisions: group.decisions.map((decision) => ({ ...decision })),
    artifacts: artifacts.get(group.slug)?.count ?? 0,
    artifactsRevision: artifacts.get(group.slug)?.revision ?? 0,
  };
}

function serviceStatus(group: Group): GroupStatus | 'done' {
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
  return {
    ...groupRow(state, group, now, NO_DIFFS, wait, artifacts),
    kind,
    status: displayStatus(serviceStatus(group), wait, groupHold(state, group)),
  };
}

function lastDeliveryAt(state: RunState): number | null {
  const times = state.groups
    .filter((group) => group.status === 'merged')
    .map((group) => group.delivery.finishedAt)
    .filter((time): time is number => time !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

/** Delivery as a system stage, by the merged groups and the delivery in progress. */
export function deliveryStage(state: RunState): DeliveryStage | null {
  const counts = deliveryCounts(state);
  if (state.run.pendingDelivery !== null) return { status: 'delivering' };
  if (counts.merged === 0) return null;
  const failed = state.groups.filter(
    (group) => group.status === 'merged' && group.delivery.state === 'apply_failed',
  );
  if (failed.length > 0) {
    return {
      status: 'apply_failed',
      reason: failed[0]?.delivery.reason ?? null,
      groups: failed.map((group) => group.slug),
    };
  }
  if (counts.applied !== counts.merged) return { status: 'pending' };
  return {
    status: 'applied',
    manual: state.groups.some((group) => group.status === 'merged' && group.delivery.manual),
  };
}

/** Status counts with the groups held back by the scheduler moved from `queued` to `waiting`. */
function countsLine(state: RunState, waiting: number): string {
  const summary = summarize(state);
  const counts: Record<string, number> = { ...summary.counts };
  const hold = state.run.hold;
  const held =
    hold === null
      ? 0
      : allGroups(state).filter(
          (group) => group.status === 'queued' && groupHold(state, group) !== null,
        ).length;
  counts['queued'] = (counts['queued'] ?? 0) - waiting - held;
  counts['waiting'] = waiting;
  if (hold !== null) counts[hold] = held;
  const order = GROUP_STATUSES.flatMap((status) =>
    status === 'queued' ? ['queued', 'waiting', 'frozen', 'paused'] : [status],
  );
  return order
    .filter((status) => (counts[status] ?? 0) > 0)
    .map((status) => `${status} ${counts[status]}`)
    .join(' · ');
}

function runDiff(state: RunState, diffs: DiffLookup): DiffTotals | null {
  const merged = state.groups
    .filter((group) => group.status === 'merged')
    .map((group) => diffs(group.slug));
  if (merged.length === 0 || merged.some((diff) => diff === null)) return null;
  const files = new Set(merged.flatMap((diff) => diff?.files.map((file) => file.path) ?? []));
  return {
    files: files.size,
    added: merged.reduce((sum, diff) => sum + (diff?.added ?? 0), 0),
    removed: merged.reduce((sum, diff) => sum + (diff?.removed ?? 0), 0),
  };
}

function runLiveDiff(state: RunState, diffs: DiffLookup): DiffTotals | null {
  const stats = state.groups
    .filter((group) => !isServiceGroup(group) && group.status !== 'cancelled')
    .map((group) => diffs(group.slug))
    .filter((diff): diff is DiffStat => diff !== null);
  if (stats.length === 0) return null;
  const files = new Set(stats.flatMap((diff) => diff.files.map((file) => file.path)));
  return {
    files: files.size,
    added: stats.reduce((sum, diff) => sum + diff.added, 0),
    removed: stats.reduce((sum, diff) => sum + diff.removed, 0),
  };
}

/** Marks the view with its return item; a finished run with one shows as `queued`. */
export function withQueue(view: RunView, item: string | null): RunView {
  if (item === null) return view;
  const state = view.hold !== null ? view.state : view.finished ? 'queued' : view.state;
  return { ...view, queueItem: item, state };
}

function runProgress(state: RunState): { done: number; total: number } {
  const { done, total } = stepProgress(state);
  return { done, total };
}

export function runView(
  state: RunState,
  now: number,
  diffs: DiffLookup = NO_DIFFS,
  catalog: readonly Tag[] = [],
  waits: WaitLookup = NO_WAITS,
  artifacts: ArtifactCounts = NO_ARTIFACTS,
): RunView {
  const summary = summarize(state);
  const waitOf = (group: Group): GroupWait | null =>
    group.status === 'queued' && groupHold(state, group) === null
      ? waits(state.run.id, group.slug)
      : null;
  const waitingGroups = state.groups.filter((group) => waitOf(group) !== null).length;
  const stages = {
    split: state.split
      ? displayStatus(
          serviceStatus(state.split),
          waitOf(state.split),
          groupHold(state, state.split),
        )
      : null,
    resolve: state.resolve ? displayStatus(state.resolve.status, waitOf(state.resolve)) : null,
  };
  const waitingTopology = topology(state);
  for (const step of waitingTopology.steps) {
    for (const group of step.groups) {
      const found = state.groups.find((candidate) => candidate.slug === group.slug);
      if (!found || group.status !== 'queued') continue;
      const shown = displayStatus('queued', waitOf(found), groupHold(state, found));
      if (shown !== 'queued') group.status = shown;
    }
  }
  if (waitingTopology.split && (stages.split === 'waiting' || isHold(stages.split))) {
    waitingTopology.split.status = stages.split;
  }
  if (waitingTopology.delivery.resolverStatus && stages.resolve === 'waiting') {
    waitingTopology.delivery.resolverStatus = 'waiting';
  }
  return {
    id: state.run.id,
    number: state.run.number,
    title: runTitle(state),
    name: state.run.name ?? null,
    repository: state.run.repository,
    workflow: state.run.workflow,
    workflowName: workflowNameOf(state.run.config, state.run.workflow),
    branch: state.run.branch,
    createdAt: state.run.createdAt,
    startedAt: runStartedAt(state),
    finishedAt: state.run.finishedAt,
    finished: summary.finished,
    state:
      state.run.hold !== null && summary.state !== 'needs_human' ? state.run.hold : summary.state,
    hold: state.run.hold,
    clockStoppedAt: clockStoppedAt(state),
    waiting: summary.waiting,
    dirtyWarning: state.run.dirtyWarning,
    autoDeliver: state.run.config.delivery.auto,
    deliveryMode: state.run.config.delivery.mode,
    fromQueue: state.run.fromQueue,
    returnable: false,
    // The queue is unknown here: the daemon fills it in with `withQueue`.
    queueItem: null,
    tags: tagViews(catalog, state.run.tags),
    counts: countsLine(state, waitingGroups),
    total: summary.total,
    usage: summary.usage,
    split: state.split
      ? {
          status: stages.split ?? 'queued',
          wait: groupHold(state, state.split) === null ? waitOf(state.split) : null,
          question: state.split.question,
          questions: state.split.questions,
          humanOnly: state.split.humanOnly,
          reason: state.split.reason,
        }
      : null,
    delivery: {
      ...deliveryCounts(state),
      inProgress: state.run.pendingDelivery !== null,
      finishedAt: lastDeliveryAt(state),
    },
    resolver: state.resolve
      ? {
          status: stages.resolve ?? state.resolve.status,
          wait: waitOf(state.resolve),
          round: state.run.pendingDelivery?.round ?? state.resolve.attempts.length,
          rounds: state.run.config.delivery.resolverRounds,
          conflicts: [...(state.run.pendingDelivery?.conflicts ?? [])],
          reason: state.resolve.reason,
        }
      : null,
    deliveryStage: deliveryStage(state),
    diff: runDiff(state, diffs),
    liveDiff: runLiveDiff(state, diffs),
    progress: runProgress(state),
    topology: waitingTopology,
    steps: stepStates(state),
    specialists: specialistUse(state),
    groups: state.groups.map((group) =>
      groupRow(state, group, now, diffs, waitOf(group), artifacts),
    ),
    system: [
      ...(state.split
        ? [systemRow(state, state.split, 'split', now, waitOf(state.split), artifacts)]
        : []),
      ...(state.message
        ? [systemRow(state, state.message, 'message', now, waitOf(state.message), artifacts)]
        : []),
      ...(state.resolve
        ? [systemRow(state, state.resolve, 'resolve', now, waitOf(state.resolve), artifacts)]
        : []),
    ],
    decisions: allGroups(state).flatMap((group) =>
      group.decisions.map((decision) => ({ ...decision, group: group.slug })),
    ),
  };
}

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

function permissionHints(attempts: AttemptView[]): string[] {
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
    branch: isSplitGroup(group) ? state.run.branch : groupRef(state.run, group.slug),
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

export interface RunCreated {
  runId: string;
  /** Number of the task of the run. */
  number: number;
  branch: string;
  groups: { slug: string; title: string }[];
  split: boolean;
  warnings: string[];
}

/** Answer to `run`: the task goes to the queue; the run exists once the queue takes the task. */
export interface RunQueued {
  item: string;
  /** Number given to the task. */
  number: number;
  run: RunCreated | null;
  queue: QueueView;
}

export interface ApplyResult {
  runId: string;
  pending: boolean;
  groups: { slug: string; delivery: GroupDelivery }[];
}

export type {
  SpecialistUse,
  StepGroup,
  StepInfo,
  StepState,
  StepTopology,
  Topology,
  WorkflowTopology,
} from '../core/index.ts';

export interface WorkflowsView {
  repository: string;
  workflows: WorkflowTopology[];
  /** Problems of the configuration; the list of workflows is empty when there are any. */
  errors: { file?: string; path: string; message: string }[];
}

export interface ConfigEditorResponse extends ConfigEditorView {
  repository: string;
}

/** The outcome of a write or delete; problems with the edit are a result, not an IPC error. */
export type ConfigEditResult =
  | { ok: true; revision: string | null; file: string }
  | { ok: false; reason: 'invalid'; errors: FieldError[]; references?: EntryReference[] }
  | { ok: false; reason: 'conflict'; message: string };

/** The specialists of one level with their tags; `repository` is null for the shared level. */
export interface SpecialistTagFolderView extends SpecialistTagFolder {
  repository: string | null;
}

export interface SpecialistTagsView {
  folders: SpecialistTagFolderView[];
}

/** The outcome of a tag edit: the folder of the level as it is now, or why nothing was written. */
export type SpecialistTagsResult =
  | { ok: true; folder: SpecialistTagFolderView }
  | { ok: false; reason: 'invalid'; errors: FieldError[] }
  | { ok: false; reason: 'conflict'; message: string; slugs?: string[] };

/** The outcome of an import: the slugs that were copied, or why nothing was. */
export type SpecialistsImportResult =
  | { ok: true; imported: string[] }
  | { ok: false; reason: 'invalid'; errors: FieldError[] }
  | { ok: false; reason: 'conflict'; message: string; slugs?: string[] };

/** The graph of a draft workflow, or the errors that keep it from being built. */
export interface ConfigPreview {
  topology: WorkflowTopology | null;
  errors: FieldError[];
}

export interface QueueItemView {
  id: string;
  /** Integer number of the task within the repository. */
  number: number;
  position: number;
  workflow: string;
  /** Display name of the workflow in the current configuration. */
  workflowName: string;
  task: string | null;
  groups: NewGroup[] | null;
  title: string | null;
  /** `null`: follows `delivery.auto` when the task starts. */
  autoDeliver: boolean | null;
  /** `null`: follows `delivery.mode` when the task starts. */
  deliveryMode: DeliveryMode | null;
  tags: TagView[];
  skip: string[];
  /** Whether the task can start now: its predecessors are done, still pending or blocked. */
  readiness: ItemReadiness;
  after: DependencyView[];
  /** A running queue does not take the task; "run now" still starts it. */
  postponed: boolean;
  createdAt: number;
  error: string | null;
  /** A returned run: taking the item retries it; null for a new task. */
  run: string | null;
  /** Hold of the run of a returned item; null for a new task and for a run without a hold. */
  hold: RunHold | null;
}

export interface DependencyView {
  kind: 'item' | 'run';
  id: string;
  /** Number of the predecessor task; null when the run is unknown. */
  number: number | null;
  title: string;
  state: DependencyState;
}

export interface QueueRunView {
  id: string;
  /** The run can go back to the queue: it has failed or cancelled groups and is not in it. */
  returnable: boolean;
  /** The run took its place by a priority action and is not frozen for another one. */
  priority: boolean;
  /** Number of the task of the run. */
  number: number;
  title: string;
  state: RunPhase;
  workflow: string;
  workflowName: string;
  tags: TagView[];
  createdAt: number;
  /** Work groups in a final status out of all work groups; `total` is 0 while the task is split. */
  groups: { done: number; total: number };
  /** Steps passed by the groups out of all their steps, and the step of a single group. */
  steps: StepProgress;
  /** Groups (service steps included) that run or merge now, with the step of their last attempt. */
  active: { group: string; step: string | null; stepName: string | null }[];
  /** Service steps of the run in the order split, message, resolve. */
  system: { kind: SystemStepKind; status: RowStatus }[];
  /** Delivery as the last system stage; null while nothing is merged. */
  delivery: DeliveryStage['status'] | null;
  /** Groups the scheduler holds back, with the step they wait to run. */
  waiting: { group: string; step: string | null; stepName: string | null; wait: GroupWait }[];
  /** The run is finished and waits for its automatic delivery. */
  delivering: boolean;
  /** Problem that keeps the user's attention, if any. */
  problem: { group: string | null; reason: ProblemReason } | null;
  /** The latest moment a group of the run waits for its usage limit to reset; null when none waits. */
  limitUntil: number | null;
  /** Tokens and cost of the run so far, live attempts included; null before any usage. */
  usage: Usage | null;
}

export interface QueueView {
  repository: string;
  status: 'stopped' | 'running';
  parallel: number;
  autopilot: boolean;
  autoAnswer: boolean;
  skipFailed: boolean;
  /** `delivery.auto` of the repository now; null when its configuration is invalid. */
  autoDeliver: boolean | null;
  /** `delivery.mode` of the repository now; null when its configuration is invalid. */
  deliveryMode: DeliveryMode | null;
  /** Text of the autopilot's answers; null: the default text. */
  autopilotAnswer: string | null;
  autopilotAnswerDefault: string;
  /** What a usage limit does: the group waits for the reset, or fails. */
  onLimit: OnLimit;
  stop: QueueStop | null;
  /** The run a priority action would freeze now; null when a place is free or there is none. */
  freezeCandidate: string | null;
  items: QueueItemView[];
  /** Runs of the queue that still occupy a place. */
  runs: QueueRunView[];
  /** Runs taken off the places because of a stopping problem, the latest first. */
  skipped: QueueRunView[];
  updatedAt: number;
}

/** Card of a run of the queue; `stopping`: the problem shown is the one that stops a queue. */
function queueRunView(
  queue: Queue,
  state: RunState,
  catalog: readonly Tag[],
  stopping: boolean,
  waits: WaitLookup,
): QueueRunView {
  const waitOf = (group: Group): GroupWait | null =>
    group.status === 'queued' ? waits(state.run.id, group.slug) : null;
  const problems = runProblems(state);
  const problem =
    (stopping ? problems.find((p) => p.reason !== 'needs_human') : undefined) ?? problems[0];
  return {
    id: state.run.id,
    returnable: canReturn(queue, state),
    priority: queue.priority.includes(state.run.id),
    number: state.run.number,
    title: runTitle(state),
    state: summarize(state).state,
    workflow: state.run.workflow,
    workflowName: workflowNameOf(state.run.config, state.run.workflow),
    tags: tagViews(catalog, state.run.tags),
    createdAt: state.run.createdAt,
    groups: {
      done: state.groups.filter((group) => isTerminal(group.status)).length,
      total: state.groups.length,
    },
    steps: stepProgress(state),
    system: [
      ...(state.split ? [{ kind: 'split' as const, group: state.split }] : []),
      ...(state.message ? [{ kind: 'message' as const, group: state.message }] : []),
      ...(state.resolve ? [{ kind: 'resolve' as const, group: state.resolve }] : []),
    ].map(({ kind, group }) => ({
      kind,
      status: displayStatus(serviceStatus(group), waitOf(group), groupHold(state, group)),
    })),
    delivery: deliveryStage(state)?.status ?? null,
    waiting: allGroups(state).flatMap((group) => {
      const wait = waitOf(group);
      if (wait === null) return [];
      const index = group.pending?.stepIndex;
      const steps = stepsOf(state.run, group);
      const found = index === undefined ? undefined : steps[index];
      return [
        {
          group: group.slug,
          step: found?.id ?? null,
          stepName: found ? stepLabel(state.run.config, steps, found) : null,
          wait,
        },
      ];
    }),
    active: allGroups(state)
      .filter((group) => group.status === 'running' || group.status === 'merging')
      .map((group) => {
        const last = group.attempts.at(-1);
        return {
          group: group.slug,
          step: last?.stepId ?? null,
          stepName: last ? attemptStepLabel(state, group, last) : null,
        };
      }),
    delivering: isRunFinished(state) && occupiesSlot(state),
    usage: summarize(state).usage,
    problem: problem ? { group: problem.group, reason: problem.reason } : null,
    limitUntil: allGroups(state).reduce<number | null>((latest, group) => {
      const until = groupLimitUntil(group);
      return until === null ? latest : Math.max(latest ?? 0, until);
    }, null),
  };
}

/** The task of an item; a returned run shows the task of the run. */
function itemBody(
  item: QueueItem,
  lookup: (id: string) => RunState | undefined,
): Pick<QueueItemView, 'task' | 'groups'> {
  if (item.run === null) return { task: item.task, groups: item.groups };
  const state = lookup(item.run);
  if (!state) return { task: null, groups: null };
  if (state.split) return { task: state.split.task, groups: null };
  if (state.groups.length === 1) return { task: state.groups[0]!.task, groups: null };
  return {
    task: null,
    groups: state.groups.map((group) => ({ title: group.title, task: group.task })),
  };
}

export function queueView(
  queue: Queue,
  lookup: (id: string) => RunState | undefined,
  autoDeliver: boolean | null = null,
  catalog: readonly Tag[] = [],
  deliveryMode: DeliveryMode | null = null,
  waits: WaitLookup = NO_WAITS,
  names: (id: string) => string = (id) => id,
): QueueView {
  const cards = (ids: string[], stopping: boolean): QueueRunView[] =>
    ids.flatMap((id) => {
      const state = lookup(id);
      return state ? [queueRunView(queue, state, catalog, stopping, waits)] : [];
    });
  const runs = cards(queue.runs, false);
  const skipped = cards(queue.skipped, true);
  return {
    repository: queue.repository,
    status: queue.status,
    parallel: queue.parallel,
    autopilot: queue.autopilot,
    autoAnswer: queue.autoAnswer,
    skipFailed: queue.skipFailed,
    autoDeliver,
    deliveryMode,
    autopilotAnswer: queue.autopilotAnswer,
    autopilotAnswerDefault: DEFAULT_AUTOPILOT_ANSWER,
    onLimit: queue.onLimit,
    stop: queue.stop,
    freezeCandidate:
      queue.runs.length >= queue.parallel
        ? freezeCandidate(
            queue,
            queue.runs.flatMap((id) => lookup(id) ?? []),
            null,
          )
        : null,
    items: queue.items.map((item, index) => ({
      id: item.id,
      number: item.number,
      position: index + 1,
      workflow: item.workflow,
      workflowName: names(item.workflow),
      ...itemBody(item, lookup),
      title: item.title,
      autoDeliver: item.autoDeliver,
      deliveryMode: item.deliveryMode,
      tags: tagViews(catalog, item.tags),
      skip: [...(item.run === null ? item.skip : (lookup(item.run)?.run.skippedSteps ?? []))],
      readiness: itemReadiness(queue, item, lookup),
      after: item.after.map((ref): DependencyView => {
        const other = queue.items.find((candidate) => candidate.id === ref);
        const state = dependencyState(queue, ref, lookup);
        if (other) {
          const label = other.title ?? (other.task ? other.task.trim().split('\n')[0] : null);
          return {
            kind: 'item',
            id: ref,
            number: other.number,
            title: label ?? other.workflow,
            state,
          };
        }
        const run = lookup(ref);
        return {
          kind: 'run',
          id: ref,
          number: run ? run.run.number : null,
          title: run ? runTitle(run) : ref,
          state,
        };
      }),
      postponed: item.postponed,
      createdAt: item.createdAt,
      error: item.error,
      run: item.run,
      hold: (item.run === null ? undefined : lookup(item.run)?.run.hold) ?? null,
    })),
    runs,
    skipped,
    updatedAt: queue.updatedAt,
  };
}

export interface RepositoryEntry {
  path: string;
  addedAt: number;
}

export interface RepositoryView {
  path: string;
  addedAt: number;
  /** Runs that are not finished yet. */
  unfinished: number;
  /** Runs waiting for a human answer. */
  waiting: number;
  /** Tasks waiting in the queue. */
  queued: number;
}

/** Registry entries with their counters, sorted by path. */
export function repositoryViews(
  entries: readonly RepositoryEntry[],
  runs: readonly RunState[],
  queues: readonly Queue[],
): RepositoryView[] {
  return entries
    .map((entry) => {
      const own = runs.filter((state) => state.run.repository === entry.path);
      const queue = queues.find((candidate) => candidate.repository === entry.path);
      return {
        path: entry.path,
        addedAt: entry.addedAt,
        unfinished: own.filter((state) => !isRunFinished(state)).length,
        waiting: own.filter((state) => runPhase(state) === 'needs_human').length,
        queued: queue?.items.length ?? 0,
      };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/** The run, group and step an agent belongs to, whose process left a background process. */
export interface BackgroundOwner {
  runId: string;
  runTitle: string;
  repository: string;
  group: string | null;
  groupTitle: string | null;
  step: string | null;
}

/** A process started by an agent (or left in its process group). */
export interface BackgroundProcessView {
  pid: number;
  /** Executable name without the directory. */
  name: string;
  /** Full command line. */
  command: string;
  uptimeSeconds: number;
  /** CPU time over the lifetime of the process, percent of one core. */
  cpuPercent: number;
  /** Resident memory. */
  memoryBytes: number;
  owner: BackgroundOwner;
}

export interface BackgroundProcessesView {
  processes: BackgroundProcessView[];
}

/** The documents of the OpenSpec change a group works on. */
export interface GroupSpecView {
  /** The directory name of the change, for example `add-export`. */
  change: string;
  /** The directory of the change from the repository root. */
  path: string;
  design: string | null;
  tasks: string | null;
}

export interface SpecCandidate {
  change: string;
  path: string;
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

/** Answer to `group_file_diff`: the diff of one file of a group, without the file headers. */
export interface FileDiffView {
  path: string;
  previousPath: string | null;
  binary: boolean;
  lines: string[];
  totalLines: number;
  truncated: boolean;
}

/** One artifact in the list of a group (`group_artifacts`). */
export interface ArtifactView {
  id: string;
  /** Workflow step of the attempt that published it. */
  step: string;
  stepName: string;
  /** Number of that attempt. */
  seq: number;
  specialist: string;
  title: string;
  fileName: string;
  size: number;
  createdAt: number;
  /** How the panel previews the file; null: download only. */
  preview: 'markdown' | 'log' | null;
}

/** Answer to `artifact`: the bytes of one artifact in base64. */
export interface ArtifactContentView {
  fileName: string;
  size: number;
  base64: string;
}

/** Answer to `run_patch`: the patch of the merged groups of a run, bytes in base64. */
export interface RunPatchView {
  fileName: string;
  size: number;
  base64: string;
}
