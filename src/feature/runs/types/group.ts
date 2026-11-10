import {
  type HumanDecision,
  type HumanMessage,
  type Usage,
  addUsage,
} from '../../agents/types/index.ts';
import {
  type Action,
  type ActionPoint,
  type Step,
  ACTION_POINTS,
  findAction,
  groupPipeline,
} from '../../swarm-config/types/index.ts';
import type { Attempt, HumanQuestion } from './attempt.ts';
import {
  type DeliveryState,
  type GroupStatus,
  ACTION_GROUP_PREFIX,
  MESSAGE_GROUP,
  MESSAGE_STEP,
  REPAIR_GROUP,
  REPAIR_SPECIALIST,
  REPAIR_STEP,
  RESOLVE_GROUP,
  RESOLVE_STEP,
  SPLIT_GROUP,
  SPLIT_STEP,
} from './constants.ts';
import { type Run, runPipeline } from './run.ts';

export interface Pending {
  stepIndex: number;
  feedback: string | null;
  humanAnswer: string | null;
  resume: boolean;
  message?: HumanMessage | null;
  reviewed?: boolean;
  /** Seq of the attempt that asked the question, when the answer goes to another step. */
  askedBy?: number;
}

export function freshPending(stepIndex: number): Pending {
  return { stepIndex, feedback: null, humanAnswer: null, resume: false };
}

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
