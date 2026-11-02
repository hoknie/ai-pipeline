import { z } from 'zod';

import type { DeliveryMode } from '../config/index.ts';
import {
  DEFAULT_AUTOPILOT_ANSWER,
  attemptVerdict,
  stepProgress,
  type StepProgress,
  describeFailReason,
  deliveryCounts,
  formatCounts,
  groupRef,
  groupUsage,
  isRunFinished,
  isServiceGroup,
  isSplitGroup,
  isTerminal,
  itemReadiness,
  dependencyState,
  knownTags,
  occupiesSlot,
  runPhase,
  runStartedAt,
  suggestPatterns,
  summarize,
  type Attempt,
  type Suggestion,
  type DependencyState,
  type Group,
  type ItemReadiness,
  type NewGroup,
  type Queue,
  type QueueStop,
  type ProblemReason,
  runProblems,
  type GroupDelivery,
  type HumanQuestion,
  type RunPhase,
  type GroupStatus,
  type RunState,
  type Tag,
  type TagColor,
  type Usage,
  topology,
  specialistUse,
  type SpecialistUse,
  type Topology,
  type WorkflowTopology,
} from '../core/index.ts';
import type { ConfigEditorView, EntryReference, FieldError } from '../config/index.ts';

/** A catalog tag as clients see it. */
export interface TagView {
  id: string;
  name: string;
  color: TagColor;
}

export function tagViews(catalog: readonly Tag[], ids: readonly string[]): TagView[] {
  const byId = new Map(catalog.map((tag) => [tag.id, tag]));
  return knownTags(catalog, ids).flatMap((id) => {
    const tag = byId.get(id);
    return tag ? [{ id: tag.id, name: tag.name, color: tag.color }] : [];
  });
}

/** The whole catalog sorted by name, ignoring case. */
export function catalogView(catalog: readonly Tag[]): TagView[] {
  return [...catalog]
    .sort(
      (a, b) =>
        a.name.toLocaleLowerCase('und').localeCompare(b.name.toLocaleLowerCase('und')) ||
        a.id.localeCompare(b.id),
    )
    .map(({ id, name, color }) => ({ id, name, color }));
}

export interface FileStat {
  path: string;
  /** Added lines; null for a binary file. */
  added: number | null;
  removed: number | null;
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

export interface GroupRow {
  slug: string;
  title: string;
  status: GroupStatus;
  step: string | null;
  round: number | null;
  durationMs: number;
  question: string | null;
  questions: HumanQuestion[] | null;
  reason: string | null;
  warnings: number;
  delivery: GroupDelivery['state'];
  diff: DiffTotals | null;
}

export interface SplitRow {
  status: GroupStatus | 'done';
  question: string | null;
  questions: HumanQuestion[] | null;
  reason: string | null;
}

export type SystemStepKind = 'split' | 'message' | 'resolve';

/** A service step of the run (split, commit message, delivery resolver). */
export interface SystemStepRow extends Omit<GroupRow, 'status'> {
  kind: SystemStepKind;
  status: GroupStatus | 'done';
}

export interface RunView {
  id: string;
  title: string;
  /** English kebab-case name; null until the run is named. */
  name: string | null;
  repository: string;
  workflow: string;
  branch: string;
  createdAt: number;
  /** When the first attempt of any group started; null while the run waits for a free slot. */
  startedAt: number | null;
  finishedAt: number | null;
  finished: boolean;
  state: RunPhase;
  /** Groups waiting for a human answer. */
  waiting: number;
  dirtyWarning: boolean;
  /** Whether the run is delivered automatically once it is merged. */
  autoDeliver: boolean;
  /** How the merged result is delivered. */
  deliveryMode: DeliveryMode;
  /** Created by a task queue. */
  fromQueue: boolean;
  tags: TagView[];
  counts: string;
  total: number;
  usage: Usage | null;
  split: SplitRow | null;
  delivery: { applied: number; merged: number; failed: number; inProgress: boolean };
  resolver: ResolverRow | null;
  /** Totals over the merged groups. */
  diff: DiffTotals | null;
  /** Steps of the workflow with the groups on them, for the topology view. */
  topology: Topology;
  /** Specialists that run or are waited for in the run, for the load across the machine. */
  specialists: SpecialistUse[];
  groups: GroupRow[];
  /** Service steps in the order split, message, resolve; absent steps are left out. */
  system: SystemStepRow[];
}

export interface ResolverRow {
  status: GroupStatus;
  round: number;
  rounds: number;
  conflicts: string[];
  reason: string | null;
}

export interface AttemptView {
  seq: number;
  stepId: string;
  round: number;
  specialist: string;
  runtime: string;
  model: string | null;
  status: string;
  verdict: string | null;
  summary: string | null;
  feedback: string | null;
  reason: string | null;
  startedAt: number;
  durationMs: number;
  usage: Usage | null;
  /** Tool calls the agent CLI refused, with allow_commands patterns that would let them run. */
  denials: DenialView[];
  /** Files the attempt changed outside its worktree. */
  outsideChanges: string[];
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
  status: GroupStatus | 'done';
  branch: string;
  worktree: string;
  question: string | null;
  questions: HumanQuestion[] | null;
  reason: string | null;
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

export function groupRow(group: Group, now: number, diffs: DiffLookup = NO_DIFFS): GroupRow {
  const legacy = legacyOutsideChanges(group);
  const last = group.attempts.at(-1);
  return {
    slug: group.slug,
    title: group.title,
    status: group.status,
    step: last?.stepId ?? null,
    round: last?.round ?? null,
    durationMs: groupDuration(group, now),
    question: group.question,
    questions: group.questions,
    reason: group.reason,
    warnings:
      legacy.warnings.length +
      group.attempts.filter(
        (attempt) => attempt.outsideChanges.length > 0 || legacy.outside.has(attempt.seq),
      ).length,
    delivery: group.delivery.state,
    diff: totals(diffs(group.slug)),
  };
}

function serviceStatus(group: Group): GroupStatus | 'done' {
  return group.status === 'merged' ? 'done' : group.status;
}

export function systemRow(group: Group, kind: SystemStepKind, now: number): SystemStepRow {
  return { ...groupRow(group, now), kind, status: serviceStatus(group) };
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

export function runView(
  state: RunState,
  now: number,
  diffs: DiffLookup = NO_DIFFS,
  catalog: readonly Tag[] = [],
): RunView {
  const summary = summarize(state);
  return {
    id: state.run.id,
    title: runTitle(state),
    name: state.run.name ?? null,
    repository: state.run.repository,
    workflow: state.run.workflow,
    branch: state.run.branch,
    createdAt: state.run.createdAt,
    startedAt: runStartedAt(state),
    finishedAt: state.run.finishedAt,
    finished: summary.finished,
    state: summary.state,
    waiting: summary.waiting,
    dirtyWarning: state.run.dirtyWarning,
    autoDeliver: state.run.config.delivery.auto,
    deliveryMode: state.run.config.delivery.mode,
    fromQueue: state.run.fromQueue,
    tags: tagViews(catalog, state.run.tags),
    counts: formatCounts(summary),
    total: summary.total,
    usage: summary.usage,
    split: state.split
      ? {
          status: serviceStatus(state.split),
          question: state.split.question,
          questions: state.split.questions,
          reason: state.split.reason,
        }
      : null,
    delivery: { ...deliveryCounts(state), inProgress: state.run.pendingDelivery !== null },
    resolver: state.resolve
      ? {
          status: state.resolve.status,
          round: state.run.pendingDelivery?.round ?? state.resolve.attempts.length,
          rounds: state.run.config.delivery.resolverRounds,
          conflicts: [...(state.run.pendingDelivery?.conflicts ?? [])],
          reason: state.resolve.reason,
        }
      : null,
    diff: runDiff(state, diffs),
    topology: topology(state),
    specialists: specialistUse(state),
    groups: state.groups.map((group) => groupRow(group, now, diffs)),
    system: [
      ...(state.split ? [systemRow(state.split, 'split', now)] : []),
      ...(state.message ? [systemRow(state.message, 'message', now)] : []),
      ...(state.resolve ? [systemRow(state.resolve, 'resolve', now)] : []),
    ],
  };
}

export function attemptView(
  attempt: Attempt,
  now: number,
  allowCommands: readonly string[] = [],
): AttemptView {
  return {
    seq: attempt.seq,
    stepId: attempt.stepId,
    round: attempt.round,
    specialist: attempt.specialist,
    runtime: attempt.runtime,
    model: attempt.model,
    status: attempt.status,
    verdict: attemptVerdict(attempt),
    summary: attempt.report?.summary ?? null,
    feedback: attempt.report?.feedback ?? null,
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
): GroupView {
  const legacy = legacyOutsideChanges(group);
  const attempts = group.attempts.map((attempt) => {
    const view = attemptView(attempt, now, allowCommandsOf(state, attempt.specialist));
    const restored = legacy.outside.get(attempt.seq);
    return restored ? { ...view, outsideChanges: restored } : view;
  });
  return {
    runId: state.run.id,
    slug: group.slug,
    title: group.title,
    task: group.task,
    status: isServiceGroup(group) ? serviceStatus(group) : group.status,
    branch: isSplitGroup(group) ? state.run.branch : groupRef(state.run, group.slug),
    worktree,
    question: group.question,
    questions: group.questions,
    reason: group.reason,
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
  branch: string;
  groups: { slug: string; title: string }[];
  split: boolean;
  warnings: string[];
}

/** Answer to `run`: the task goes to the queue; the run exists once the queue takes the task. */
export interface RunQueued {
  item: string;
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

/** The graph of a draft workflow, or the errors that keep it from being built. */
export interface ConfigPreview {
  topology: WorkflowTopology | null;
  errors: FieldError[];
}

export interface QueueItemView {
  id: string;
  position: number;
  workflow: string;
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
  createdAt: number;
  error: string | null;
}

export interface DependencyView {
  kind: 'item' | 'run';
  id: string;
  title: string;
  state: DependencyState;
}

export interface QueueRunView {
  id: string;
  title: string;
  state: RunPhase;
  workflow: string;
  tags: TagView[];
  createdAt: number;
  /** Work groups in a final status out of all work groups; `total` is 0 while the task is split. */
  groups: { done: number; total: number };
  /** Steps passed by the groups out of all their steps, and the step of a single group. */
  steps: StepProgress;
  /** Groups that run or merge now, with the step of their last attempt. */
  active: { group: string; step: string | null }[];
  /** The run is finished and waits for its automatic delivery. */
  delivering: boolean;
  /** Problem that keeps the user's attention, if any. */
  problem: { group: string | null; reason: ProblemReason } | null;
}

export interface QueueView {
  repository: string;
  status: 'stopped' | 'running';
  parallel: number;
  autopilot: boolean;
  skipFailed: boolean;
  /** `delivery.auto` of the repository now; null when its configuration is invalid. */
  autoDeliver: boolean | null;
  /** `delivery.mode` of the repository now; null when its configuration is invalid. */
  deliveryMode: DeliveryMode | null;
  /** Text of the autopilot's answers; null: the default text. */
  autopilotAnswer: string | null;
  autopilotAnswerDefault: string;
  stop: QueueStop | null;
  items: QueueItemView[];
  /** Runs of the queue that still occupy a place. */
  runs: QueueRunView[];
  /** Runs taken off the places because of a stopping problem, the latest first. */
  skipped: QueueRunView[];
  updatedAt: number;
}

/** Card of a run of the queue; `stopping`: the problem shown is the one that stops a queue. */
function queueRunView(state: RunState, catalog: readonly Tag[], stopping: boolean): QueueRunView {
  const problems = runProblems(state);
  const problem =
    (stopping ? problems.find((p) => p.reason !== 'needs_human') : undefined) ?? problems[0];
  return {
    id: state.run.id,
    title: runTitle(state),
    state: summarize(state).state,
    workflow: state.run.workflow,
    tags: tagViews(catalog, state.run.tags),
    createdAt: state.run.createdAt,
    groups: {
      done: state.groups.filter((group) => isTerminal(group.status)).length,
      total: state.groups.length,
    },
    steps: stepProgress(state),
    active: state.groups
      .filter((group) => group.status === 'running' || group.status === 'merging')
      .map((group) => ({ group: group.slug, step: group.attempts.at(-1)?.stepId ?? null })),
    delivering: isRunFinished(state) && occupiesSlot(state),
    problem: problem ? { group: problem.group, reason: problem.reason } : null,
  };
}

export function queueView(
  queue: Queue,
  lookup: (id: string) => RunState | undefined,
  autoDeliver: boolean | null = null,
  catalog: readonly Tag[] = [],
  deliveryMode: DeliveryMode | null = null,
): QueueView {
  const cards = (ids: string[], stopping: boolean): QueueRunView[] =>
    ids.flatMap((id) => {
      const state = lookup(id);
      return state ? [queueRunView(state, catalog, stopping)] : [];
    });
  const runs = cards(queue.runs, false);
  const skipped = cards(queue.skipped, true);
  return {
    repository: queue.repository,
    status: queue.status,
    parallel: queue.parallel,
    autopilot: queue.autopilot,
    skipFailed: queue.skipFailed,
    autoDeliver,
    deliveryMode,
    autopilotAnswer: queue.autopilotAnswer,
    autopilotAnswerDefault: DEFAULT_AUTOPILOT_ANSWER,
    stop: queue.stop,
    items: queue.items.map((item, index) => ({
      id: item.id,
      position: index + 1,
      workflow: item.workflow,
      task: item.task,
      groups: item.groups,
      title: item.title,
      autoDeliver: item.autoDeliver,
      deliveryMode: item.deliveryMode,
      tags: tagViews(catalog, item.tags),
      skip: [...item.skip],
      readiness: itemReadiness(queue, item, lookup),
      after: item.after.map((ref): DependencyView => {
        const other = queue.items.find((candidate) => candidate.id === ref);
        const state = dependencyState(queue, ref, lookup);
        if (other) {
          const label = other.title ?? (other.task ? other.task.trim().split('\n')[0] : null);
          return { kind: 'item', id: ref, title: label ?? other.workflow, state };
        }
        const run = lookup(ref);
        return { kind: 'run', id: ref, title: run ? runTitle(run) : ref, state };
      }),
      createdAt: item.createdAt,
      error: item.error,
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
