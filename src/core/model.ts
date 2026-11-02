import type { ResolvedConfig, Runtime, Step, Workflow } from '../config/index.ts';
import { findWorkflow, groupWorkflow } from '../config/index.ts';
import type { Denial } from './permissions.ts';

export const SPLIT_GROUP = '_split';
export const SPLIT_STEP = 'split';
export const MESSAGE_GROUP = '_message';
export const MESSAGE_STEP = 'message';
export const RESOLVE_GROUP = '_resolve';
export const RESOLVE_STEP = 'resolve';
export const SUMMARY_LIMIT = 4000;
export const FEEDBACK_LIMIT = 16000;

export const GROUP_STATUSES = [
  'queued',
  'running',
  'needs_human',
  'merging',
  'merged',
  'conflict',
  'failed',
  'cancelled',
] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

export function isTerminal(status: GroupStatus): boolean {
  return status === 'merged' || status === 'failed' || status === 'cancelled';
}

export const VERDICTS = ['done', 'rejected', 'needs_human'] as const;
export type Verdict = (typeof VERDICTS)[number];

export type AttemptStatus = 'running' | 'finished' | 'failed' | 'cancelled';

export const QUESTIONS_LIMIT = 10;
export const QUESTION_TEXT_LIMIT = 2000;
export const OPTIONS_LIMIT = 6;
export const OPTION_LIMIT = 200;
export const RECOMMENDATION_LIMIT = 2000;

/** One question of a specialist to the human, with optional options and a recommended answer. */
export interface HumanQuestion {
  text: string;
  options?: string[] | null;
  recommendation?: string | null;
}

export interface Report {
  verdict: Verdict;
  summary: string;
  feedback: string | null;
  questions?: HumanQuestion[] | null;
}

export type FailReason =
  | { kind: 'timeout' }
  | { kind: 'no_report' }
  | { kind: 'interrupted' }
  | { kind: 'no_groups' }
  | { kind: 'runtime_not_found'; runtime: string }
  | { kind: 'spawn'; message: string }
  | { kind: 'git'; message: string }
  /** The runtime ran out of its usage limit; `resetsAt`: when it resets (ms), null when unknown. */
  | { kind: 'usage_limit'; resetsAt: number | null };

/** What a usage limit does to a group: wait for the reset or fail. */
export const ON_LIMIT_MODES = ['wait', 'stop'] as const;
export type OnLimit = (typeof ON_LIMIT_MODES)[number];

/** How long a usage limit holds when the runtime did not say when it resets. */
export const USAGE_LIMIT_FALLBACK_MS = 15 * 60 * 1000;

/** Local `HH:MM` of a moment. */
export function clockTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function describeFailReason(reason: FailReason): string {
  switch (reason.kind) {
    case 'timeout':
      return 'timeout';
    case 'no_report':
      return 'no report';
    case 'interrupted':
      return 'interrupted';
    case 'no_groups':
      return 'no groups';
    case 'runtime_not_found':
      return `runtime not found: ${reason.runtime}`;
    case 'spawn':
      return `spawn error: ${reason.message}`;
    case 'git':
      return `git: ${reason.message}`;
    case 'usage_limit':
      return reason.resetsAt === null
        ? 'usage limit'
        : `usage limit, resets ${clockTime(reason.resetsAt)}`;
  }
}

export function validateReport(report: Report): string | null {
  if (report.summary.trim() === '') return 'summary must not be empty';
  if ([...report.summary].length > SUMMARY_LIMIT) {
    return `summary must be at most ${SUMMARY_LIMIT} characters`;
  }
  const feedback = report.feedback?.trim() ? report.feedback : null;
  const questions = report.questions ?? null;
  if (questions !== null) {
    if (report.verdict !== 'needs_human') {
      return 'questions are allowed only when verdict is needs_human';
    }
    const problem = validateQuestions(questions);
    if (problem !== null) return problem;
  }
  if (feedback === null && questions === null && report.verdict !== 'done') {
    return `feedback is required when verdict is ${report.verdict}`;
  }
  if (feedback !== null && [...feedback].length > FEEDBACK_LIMIT) {
    return `feedback must be at most ${FEEDBACK_LIMIT} characters`;
  }
  return null;
}

function validateQuestions(questions: HumanQuestion[]): string | null {
  if (questions.length < 1 || questions.length > QUESTIONS_LIMIT) {
    return `questions must contain 1 to ${QUESTIONS_LIMIT} items`;
  }
  for (const [index, question] of questions.entries()) {
    const name = `questions[${index}]`;
    if (question.text.trim() === '') return `${name}.text must not be empty`;
    if ([...question.text].length > QUESTION_TEXT_LIMIT) {
      return `${name}.text must be at most ${QUESTION_TEXT_LIMIT} characters`;
    }
    const options = question.options ?? null;
    if (options !== null) {
      if (options.length < 1 || options.length > OPTIONS_LIMIT) {
        return `${name}.options must contain 1 to ${OPTIONS_LIMIT} items`;
      }
      for (const option of options) {
        if (option.trim() === '') return `${name}.options must not contain empty strings`;
        if ([...option].length > OPTION_LIMIT) {
          return `${name}.options items must be at most ${OPTION_LIMIT} characters`;
        }
      }
    }
    const recommendation = question.recommendation ?? null;
    if (recommendation !== null) {
      if (recommendation.trim() === '') return `${name}.recommendation must not be empty`;
      if ([...recommendation].length > RECOMMENDATION_LIMIT) {
        return `${name}.recommendation must be at most ${RECOMMENDATION_LIMIT} characters`;
      }
    }
  }
  return null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export function addUsage(total: Usage | null, usage: Usage | null): Usage | null {
  if (usage === null) return total;
  if (total === null) return { ...usage };
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    costUsd:
      total.costUsd === null && usage.costUsd === null
        ? null
        : (total.costUsd ?? 0) + (usage.costUsd ?? 0),
  };
}

export interface PreviousStep {
  stepId: string;
  specialist: string;
  verdict: Verdict;
  summary: string;
}

export interface HumanDecision {
  stepId: string;
  question: string;
  answer: string;
  /** Who answered: a person or the autopilot of the queue. */
  by: 'human' | 'autopilot';
}

export interface StepInput {
  prompt: string;
  groupTitle: string;
  stepId: string;
  specialistName: string;
  skills: string[];
  previous: PreviousStep[];
  feedback: string | null;
  humanAnswer: string | null;
  decisions: HumanDecision[];
}

export interface ProposedGroup {
  title: string;
  task: string;
}

export interface Attempt {
  seq: number;
  stepId: string;
  stepIndex: number;
  round: number;
  specialist: string;
  runtime: Runtime;
  model: string | null;
  status: AttemptStatus;
  input: StepInput;
  resumeSession: string | null;
  sessionId: string | null;
  report: Report | null;
  reason: FailReason | null;
  startedAt: number;
  finishedAt: number | null;
  usage: Usage | null;
  proposal: ProposedGroup[] | null;
  /** Tool calls the agent CLI refused during the attempt. */
  denials: Denial[];
  /** Files the attempt changed outside its worktree. */
  outsideChanges: string[];
}

export interface Pending {
  stepIndex: number;
  feedback: string | null;
  humanAnswer: string | null;
  resume: boolean;
}

export function freshPending(stepIndex: number): Pending {
  return { stepIndex, feedback: null, humanAnswer: null, resume: false };
}

export const DELIVERY_STATES = ['pending', 'applied', 'apply_failed'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export interface GroupDelivery {
  state: DeliveryState;
  reason: string | null;
  files: string[];
  conflicts: string[];
  /** Files committed whole together with uncommitted edits the user had in them. */
  userEdits: string[];
}

export function pendingDelivery(): GroupDelivery {
  return { state: 'pending', reason: null, files: [], conflicts: [], userEdits: [] };
}

export interface Group {
  slug: string;
  title: string;
  task: string;
  position: number;
  status: GroupStatus;
  pending: Pending | null;
  rejections: Record<string, number>;
  attempts: Attempt[];
  question: string | null;
  questions: HumanQuestion[] | null;
  reason: string | null;
  warnings: string[];
  decisions: HumanDecision[];
  conflictFiles: string[];
  mergeSeq: number | null;
  mergeInFlight: boolean;
  updateOnConflict: boolean;
  mergeCommit: string | null;
  delivery: GroupDelivery;
}

export function newGroup(slug: string, title: string, task: string, position: number): Group {
  return {
    slug,
    title,
    task,
    position,
    status: 'queued',
    pending: freshPending(0),
    rejections: {},
    attempts: [],
    question: null,
    questions: null,
    reason: null,
    warnings: [],
    decisions: [],
    conflictFiles: [],
    mergeSeq: null,
    mergeInFlight: false,
    updateOnConflict: false,
    mergeCommit: null,
    delivery: pendingDelivery(),
  };
}

export function groupUsage(group: Group): Usage | null {
  return group.attempts.reduce<Usage | null>(
    (total, attempt) => addUsage(total, attempt.usage),
    null,
  );
}

export function attemptVerdict(attempt: Attempt): Verdict | null {
  return attempt.status === 'finished' ? (attempt.report?.verdict ?? null) : null;
}

export interface Run {
  id: string;
  repository: string;
  workflow: string;
  baseCommit: string;
  branch: string;
  refStyle: RefStyle;
  createdAt: number;
  finishedAt: number | null;
  config: ResolvedConfig;
  dirtyWarning: boolean;
  nextMergeSeq: number;
  pendingDelivery: PendingDelivery | null;
  /** Short title in the language of the task; null until known. */
  title: string | null;
  /** English kebab-case name, like the name of an OpenSpec change. */
  name: string | null;
  /** Usage of the call that named the run. */
  namingUsage: Usage | null;
  /** Created by a task queue. */
  fromQueue: boolean;
  /** Id of the queue item the run started from; null for a run outside the queue. */
  queueItem: string | null;
  /** Ids of catalog tags. */
  tags: string[];
}

export interface PendingDelivery {
  groups: string[];
  force: boolean;
  auto: boolean;
  /** Commit message of the delivery, once known. */
  message?: string | null;
  /** Resolver rounds started for this delivery. */
  round?: number;
  /** Files that conflicted in the last attempt. */
  conflicts?: string[];
}

export interface RunState {
  run: Run;
  split: Group | null;
  groups: Group[];
  message: Group | null;
  resolve: Group | null;
}

export function runWorkflow(run: Run): Workflow {
  const workflow = findWorkflow(run.config, run.workflow);
  if (!workflow) throw new Error(`run ${run.id} has no workflow ${run.workflow}`);
  return workflow;
}

export type RefStyle = 'branches' | 'refs';

export function runRef(run: Run): string {
  return run.branch;
}

export function groupRef(run: Run, group: string): string {
  return run.refStyle === 'refs' ? `refs/aip/${run.id}/groups/${group}` : `${run.branch}-${group}`;
}

export function deliveryBranch(run: Run): string {
  return `aip/${run.id}`;
}

export function findGroup(state: RunState, slug: string): Group | undefined {
  if (slug === SPLIT_GROUP) return state.split ?? undefined;
  if (slug === MESSAGE_GROUP) return state.message ?? undefined;
  if (slug === RESOLVE_GROUP) return state.resolve ?? undefined;
  return state.groups.find((group) => group.slug === slug);
}

export function allGroups(state: RunState): Group[] {
  return [
    ...(state.split ? [state.split] : []),
    ...state.groups,
    ...(state.message ? [state.message] : []),
    ...(state.resolve ? [state.resolve] : []),
  ];
}

export function isSplitGroup(group: Group): boolean {
  return group.slug === SPLIT_GROUP;
}

export function isMessageGroup(group: Group): boolean {
  return group.slug === MESSAGE_GROUP;
}

export function isResolveGroup(group: Group): boolean {
  return group.slug === RESOLVE_GROUP;
}

export function isServiceGroup(group: Group): boolean {
  return isSplitGroup(group) || isMessageGroup(group) || isResolveGroup(group);
}

export function stepsOf(run: Run, group: Group): Step[] {
  const workflow = runWorkflow(run);
  if (isMessageGroup(group)) {
    const specialist = run.config.delivery.messageSpecialist;
    if (!specialist) throw new Error('no delivery.message_specialist is configured');
    return [{ id: MESSAGE_STEP, specialist, onReject: null, additionalPrompt: null }];
  }
  if (isResolveGroup(group)) {
    const specialist = run.config.delivery.resolver;
    if (!specialist) throw new Error('no delivery.resolver is configured');
    return [{ id: RESOLVE_STEP, specialist, onReject: null, additionalPrompt: null }];
  }
  if (!isSplitGroup(group)) return groupWorkflow(run.config, workflow).steps;
  if (!workflow.split) throw new Error(`workflow ${workflow.id} has no split`);
  return [
    {
      id: SPLIT_STEP,
      specialist: workflow.split.specialist,
      onReject: null,
      // Runs saved before the field existed have no value.
      additionalPrompt: workflow.split.additionalPrompt ?? null,
    },
  ];
}

export function isRunFinished(state: RunState): boolean {
  const units = allGroups(state);
  return units.length > 0 && units.every((group) => isTerminal(group.status));
}

export type RunPhase = 'needs_human' | 'active' | 'finished' | 'cancelled' | 'failed';

/**
 * For a finished run: `cancelled` when the split or any work group was cancelled; otherwise
 * `failed` when the split or a work group failed, or a merged group's delivery is `apply_failed`;
 * otherwise `finished`. Delivery groups (message, resolve) do not count.
 */
export function runPhase(state: RunState): RunPhase {
  if (!isRunFinished(state)) {
    return allGroups(state).some((group) => group.status === 'needs_human')
      ? 'needs_human'
      : 'active';
  }
  const cancelled =
    state.split?.status === 'cancelled' ||
    state.groups.some((group) => group.status === 'cancelled');
  if (cancelled) return 'cancelled';
  const failed =
    state.split?.status === 'failed' ||
    state.groups.some(
      (group) =>
        group.status === 'failed' ||
        (group.status === 'merged' && group.delivery.state === 'apply_failed'),
    );
  return failed ? 'failed' : 'finished';
}
