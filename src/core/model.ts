import type {
  Action,
  ActionPoint,
  ResolvedConfig,
  Runtime,
  Specialist,
  Step,
  Pipeline,
} from '../config/index.ts';
import {
  ACTION_POINTS,
  OBSERVER_SPECIALIST,
  findAction,
  findSpecialist,
  findPipeline,
  groupPipeline,
} from '../config/index.ts';
import type { Denial } from './permissions.ts';

export const SPLIT_GROUP = '_split';
export const SPLIT_STEP = 'split';
export const MESSAGE_GROUP = '_message';
export const MESSAGE_STEP = 'message';
export const RESOLVE_GROUP = '_resolve';
export const RESOLVE_STEP = 'resolve';
export const REPAIR_GROUP = '_repair';
export const REPAIR_STEP = 'repair';
/** Slug of the specialist of the observer; the profile itself lives in `Run.repair.specialist`. */
export const REPAIR_SPECIALIST = OBSERVER_SPECIALIST;
/** Prefix of the slugs of pipeline action groups: `_action-<point>-<id>`. */
export const ACTION_GROUP_PREFIX = '_action-';
export const ACTION_STEP = 'action';
/** Runtime of the attempt of a command action: the daemon runs a shell command, not an agent. */
export const COMMAND_RUNTIME = 'command';
export type AttemptRuntime = Runtime | typeof COMMAND_RUNTIME;
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
  /** With `needs_human`: only a person can answer; the queue autopilot leaves it alone. */
  humanOnly?: boolean;
}

export type FailReason =
  | { kind: 'timeout' }
  | { kind: 'no_report' }
  | { kind: 'interrupted' }
  /** A command action ended with a non-zero exit code. */
  | { kind: 'exit_code'; code: number }
  | { kind: 'no_groups' }
  | { kind: 'runtime_not_found'; runtime: string }
  | { kind: 'spawn'; message: string }
  | { kind: 'git'; message: string }
  /** The step was skipped while its attempt ran. */
  | { kind: 'skipped' }
  /** The runtime ran out of its usage limit; `resetsAt`: when it resets (ms), null when unknown. */
  | { kind: 'usage_limit'; resetsAt: number | null }
  /** A human message interrupted the attempt; the step continues in the same session. */
  | { kind: 'message'; text: string; at: number }
  /** A pause of the run stopped the attempt; the step continues in the same session. */
  | { kind: 'paused'; at: number };

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
    case 'exit_code':
      return `exit code ${reason.code}`;
    case 'no_groups':
      return 'no groups';
    case 'runtime_not_found':
      return `runtime not found: ${reason.runtime}`;
    case 'spawn':
      return `spawn error: ${reason.message}`;
    case 'git':
      return `git: ${reason.message}`;
    case 'skipped':
      return 'step skipped';
    case 'message':
      return 'interrupted by a message';
    case 'paused':
      return 'interrupted by a pause';
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
  if (report.humanOnly && report.verdict !== 'needs_human') {
    return 'human_only is allowed only when verdict is needs_human';
  }
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
  /** Who answered: a person, the autopilot of the queue or an observer. */
  by: 'human' | 'autopilot' | 'observer';
  /** Number of the attempt that asked the question. */
  attemptSeq?: number;
}

export interface HumanMessage {
  text: string;
  /** When the daemon accepted the message (ms). */
  at: number;
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
  /** A message the human sent to the specialist while the previous attempt ran. */
  message?: HumanMessage | null;
  /** The step was resumed by the answer to a human review: its `done` goes on without a new review. */
  reviewed?: boolean;
  /** The step stops for a human review after `done`. */
  humanReview?: boolean;
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
  runtime: AttemptRuntime;
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
  message?: HumanMessage | null;
  reviewed?: boolean;
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
  /** Commit message of the delivery; absent in runs stored before the field existed. */
  message?: string | null;
  /** The user merged the result by hand and marked the group delivered; no git operation ran. */
  manual: boolean;
  /** When the last delivery attempt of the group ended (ms); null before the first attempt. */
  finishedAt: number | null;
}

export function pendingDelivery(): GroupDelivery {
  return {
    state: 'pending',
    reason: null,
    files: [],
    conflicts: [],
    userEdits: [],
    manual: false,
    finishedAt: null,
  };
}

export type HumanOnly = 'review' | 'request';

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
  /** Why the open question is for a person only; null: anyone may answer. */
  humanOnly: HumanOnly | null;
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
    humanOnly: null,
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

/** Why the scheduler does not start new steps of a run. */
export const RUN_HOLDS = ['paused', 'frozen'] as const;
export type RunHold = (typeof RUN_HOLDS)[number];

export interface Run {
  id: string;
  repository: string;
  pipeline: string;
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
  /** Number of the task the run was created for. */
  number: number;
  /** Ids of catalog tags. */
  tags: string[];
  /** Steps skipped after the start; the step list of the snapshot is unchanged. */
  skippedSteps: string[];
  /** The run is held and starts no step; null when it runs normally. */
  hold: RunHold | null;
  /** State of the observer repairs of the run. */
  repair: RunRepair;
}

export const INCIDENT_KINDS = ['question', 'failed', 'conflict', 'delivery'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/** A state of a group an observer repairs; `key` includes the attempts of the group. */
export interface Incident {
  key: string;
  kind: IncidentKind;
  group: string;
  detail: string;
}

export interface RunRepair {
  /** An observer may take the incidents of the run. */
  allowed: boolean;
  /** Repairs started for the run. */
  repairs: number;
  /** Keys of incidents the observer reported on. */
  taken: string[];
  /** The incident being repaired; set from the start of a repair to its end. */
  incident: Incident | null;
  /** Profile of the observer when the repair started. */
  specialist: Specialist | null;
  /** Why the observer cancelled the whole run. */
  cancelReason: string | null;
}

export function emptyRepair(): RunRepair {
  return {
    allowed: true,
    repairs: 0,
    taken: [],
    incident: null,
    specialist: null,
    cancelReason: null,
  };
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
  /** Files the delivery changes, as the request named them; for the commit message author. */
  files?: string[];
  /** The delivery waits for the actions before it. */
  checks?: boolean;
  /** An observer repairs the delivery: no commit message author, no resolver rounds. */
  repair?: boolean;
}

export interface RunState {
  run: Run;
  split: Group | null;
  groups: Group[];
  message: Group | null;
  resolve: Group | null;
  /** The group of the repairs of an observer; one attempt per repair. */
  repair: Group | null;
  /** Groups of pipeline actions in the order of the points, then of the lists of the points. */
  actions: Group[];
}

export function runPipeline(run: Run): Pipeline {
  const pipeline = findPipeline(run.config, run.pipeline);
  if (!pipeline) throw new Error(`run ${run.id} has no pipeline ${run.pipeline}`);
  return pipeline;
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

export function actionSlug(point: ActionPoint, id: string): string {
  return `${ACTION_GROUP_PREFIX}${point.replaceAll('_', '-')}-${id}`;
}

export interface ActionRef {
  point: ActionPoint;
  id: string;
}

/** The point and the action id of an action group slug; null for any other slug. */
export function parseActionSlug(slug: string): ActionRef | null {
  if (!slug.startsWith(ACTION_GROUP_PREFIX)) return null;
  const rest = slug.slice(ACTION_GROUP_PREFIX.length);
  for (const point of ACTION_POINTS) {
    const prefix = `${point.replaceAll('_', '-')}-`;
    if (rest.startsWith(prefix) && rest.length > prefix.length) {
      return { point, id: rest.slice(prefix.length) };
    }
  }
  return null;
}

export function isActionGroup(group: Group): boolean {
  return parseActionSlug(group.slug) !== null;
}

/** The point of an action group; undefined for any other group. */
export function actionPointOf(group: Group): ActionPoint | undefined {
  return parseActionSlug(group.slug)?.point;
}

/** The action a group runs, from the snapshot of the run. */
export function actionOf(run: Run, group: Group): Action | undefined {
  const ref = parseActionSlug(group.slug);
  return ref ? findAction(run.config, ref.id) : undefined;
}

export function findGroup(state: RunState, slug: string): Group | undefined {
  if (slug === SPLIT_GROUP) return state.split ?? undefined;
  if (slug === MESSAGE_GROUP) return state.message ?? undefined;
  if (slug === RESOLVE_GROUP) return state.resolve ?? undefined;
  if (slug === REPAIR_GROUP) return state.repair ?? undefined;
  if (slug.startsWith(ACTION_GROUP_PREFIX)) {
    return (state.actions ?? []).find((group) => group.slug === slug);
  }
  return state.groups.find((group) => group.slug === slug);
}

/** The action groups of one point in the order of its list. */
export function actionGroupsOf(state: RunState, point: ActionPoint): Group[] {
  return (state.actions ?? []).filter((group) => actionPointOf(group) === point);
}

export function allGroups(state: RunState): Group[] {
  return [
    ...actionGroupsOf(state, 'before_split'),
    ...(state.split ? [state.split] : []),
    ...actionGroupsOf(state, 'after_split'),
    ...state.groups,
    ...actionGroupsOf(state, 'before_delivery'),
    ...(state.message ? [state.message] : []),
    ...(state.resolve ? [state.resolve] : []),
    ...(state.repair ? [state.repair] : []),
    ...actionGroupsOf(state, 'after_delivery'),
  ];
}

/** Settled for the pipeline: the action is done, or failed and the pipeline goes on anyway. */
export function actionClosed(run: Run, group: Group): boolean {
  if (group.status === 'merged') return true;
  const action = actionOf(run, group);
  if (group.status === 'failed') return action?.onFailure === 'continue';
  // Cancelling a command after delivery only releases the cleanup.
  if (group.status === 'cancelled') {
    return action?.onFailure === 'continue' || actionPointOf(group) === 'after_delivery';
  }
  return false;
}

/** Every action of the point is settled; also true for a point that has no actions. */
export function pointClosed(state: RunState, point: ActionPoint): boolean {
  return actionGroupsOf(state, point).every((group) => actionClosed(state.run, group));
}

/** The first action of the point that is not settled. */
export function openAction(state: RunState, point: ActionPoint): Group | undefined {
  return actionGroupsOf(state, point).find((group) => !actionClosed(state.run, group));
}

/** The open action of the point stopped the pipeline and waits for a retry. */
export function pointStalled(state: RunState, point: ActionPoint): boolean {
  const open = openAction(state, point);
  return open !== undefined && (open.status === 'failed' || open.status === 'cancelled');
}

/** A queued group that waits for an action which stopped the pipeline: only a retry frees it. */
export function isHeldByAction(state: RunState, group: Group): boolean {
  if (group.status !== 'queued') return false;
  const point = actionPointOf(group);
  if (point !== undefined) {
    const open = openAction(state, point);
    return open !== undefined && open !== group && pointStalled(state, point);
  }
  if (group === state.split) return pointStalled(state, 'before_split');
  if (state.groups.includes(group)) return pointStalled(state, 'after_split');
  return false;
}

/**
 * A check before delivery works in the tree of the run or is about to, and merges use that tree.
 * A check that stopped the pipeline, and the ones held behind it, keep no merge waiting.
 */
export function deliveryCheckActive(state: RunState): boolean {
  return actionGroupsOf(state, 'before_delivery').some(
    (group) =>
      group.status === 'running' || (group.status === 'queued' && !isHeldByAction(state, group)),
  );
}

/** Action groups that failed or were cancelled and stop the pipeline. */
export function stoppedActions(state: RunState, status: 'failed' | 'cancelled'): Group[] {
  return (state.actions ?? []).filter(
    (group) => group.status === status && !actionClosed(state.run, group),
  );
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

export function isRepairGroup(group: Group): boolean {
  return group.slug === REPAIR_GROUP;
}

export function isServiceGroup(group: Group): boolean {
  return (
    isSplitGroup(group) ||
    isMessageGroup(group) ||
    isResolveGroup(group) ||
    isRepairGroup(group) ||
    isActionGroup(group)
  );
}

export function stepsOf(run: Run, group: Group): Step[] {
  const pipeline = runPipeline(run);
  if (isActionGroup(group)) {
    const action = actionOf(run, group);
    const ref = parseActionSlug(group.slug);
    if (!action || !ref) throw new Error(`group ${group.slug} has no action in the configuration`);
    return [
      {
        id: ref.id,
        specialist: action.specialist ?? action.id,
        onReject: null,
        additionalPrompt: action.additionalPrompt,
        humanReview: false,
      },
    ];
  }
  if (isMessageGroup(group)) {
    const specialist = run.config.delivery.messageSpecialist;
    if (!specialist) throw new Error('no delivery.message_specialist is configured');
    return [
      { id: MESSAGE_STEP, specialist, onReject: null, additionalPrompt: null, humanReview: false },
    ];
  }
  if (isResolveGroup(group)) {
    const specialist = run.config.delivery.resolver;
    if (!specialist) throw new Error('no delivery.resolver is configured');
    return [
      { id: RESOLVE_STEP, specialist, onReject: null, additionalPrompt: null, humanReview: false },
    ];
  }
  if (isRepairGroup(group)) {
    return [
      {
        id: REPAIR_STEP,
        specialist: REPAIR_SPECIALIST,
        onReject: null,
        additionalPrompt: null,
        humanReview: false,
      },
    ];
  }
  if (!isSplitGroup(group)) return groupPipeline(run.config, pipeline).steps;
  if (!pipeline.split) throw new Error(`pipeline ${pipeline.id} has no split`);
  return [
    {
      id: SPLIT_STEP,
      specialist: pipeline.split.specialist,
      onReject: null,
      // Runs saved before the field existed have no value.
      additionalPrompt: pipeline.split.additionalPrompt ?? null,
      humanReview: false,
    },
  ];
}

function groupsSettled(state: RunState, units: Group[]): boolean {
  return (
    units.length > 0 &&
    units.every((group) => isTerminal(group.status) || isHeldByAction(state, group))
  );
}

/** A run with an incident under repair is not finished, even before the repair group exists. */
export function isRunFinished(state: RunState): boolean {
  return state.run.repair.incident === null && groupsSettled(state, allGroups(state));
}

/**
 * Finished as `isRunFinished` is, but without the incident under repair and without the repair
 * group: the view of the queue on a run an observer works on.
 */
export function finishedApartFromRepair(state: RunState): boolean {
  // Without an incident the run is finished exactly when `finishedAt` is set.
  if (state.run.repair.incident === null) return state.run.finishedAt !== null;
  return groupsSettled(
    state,
    allGroups(state).filter((group) => !isRepairGroup(group)),
  );
}

/** The specialist of a step: the snapshot of the observer for the repair group, else the config. */
export function specialistOfStep(run: Run, group: Group, slug: string): Specialist | undefined {
  if (isRepairGroup(group)) return run.repair.specialist ?? undefined;
  return findSpecialist(run.config, slug);
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
    state.groups.some((group) => group.status === 'cancelled') ||
    stoppedActions(state, 'cancelled').length > 0;
  if (cancelled) return 'cancelled';
  const failed =
    state.split?.status === 'failed' ||
    state.groups.some(
      (group) =>
        group.status === 'failed' ||
        (group.status === 'merged' && group.delivery.state === 'apply_failed'),
    ) ||
    stoppedActions(state, 'failed').length > 0;
  return failed ? 'failed' : 'finished';
}
