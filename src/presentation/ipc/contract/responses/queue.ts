import type { Usage } from '../../../../feature/agents/types/index.ts';
import type {
  DependencyState,
  ItemReadiness,
  QueueStop,
  TaskLinkView,
} from '../../../../feature/queue/types/index.ts';
import type {
  GroupWait,
  NewGroup,
  OnLimit,
  ProblemReason,
  RunHold,
  RunPhase,
  StepProgress,
} from '../../../../feature/runs/types/index.ts';
import type { DeliveryMode } from '../../../../feature/swarm-config/types/index.ts';
import type { AttachmentView } from './attachments.ts';
import type { DeliveryStage, RowStatus, SystemStepKind } from './runs.ts';
import type { TagView } from './tags.ts';

export interface QueueItemView {
  id: string;
  /** Integer number of the task within the repository. */
  number: number;
  position: number;
  pipeline: string;
  /** Display name of the pipeline in the current configuration. */
  pipelineName: string;
  /** Id of the pipeline variant; `default` for the pipeline as it is. */
  variant: string;
  /** Name of the variant in the current configuration; the id without a name. */
  variantName: string;
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
  /** Links where the task is the source; `related` shows from both sides. */
  links: TaskLinkView[];
  /** Links where the task is the target, with the kind of the original link. */
  linkedBy: TaskLinkView[];
  /** A running queue does not take the task; "run now" still starts it. */
  postponed: boolean;
  /** The item does not fit the take filter: a running queue does not take it. */
  filtered: boolean;
  createdAt: number;
  error: string | null;
  /** A returned run: taking the item retries it; null for a new task. */
  run: string | null;
  /** Hold of the run of a returned item; null for a new task and for a run without a hold. */
  hold: RunHold | null;
  /** Files attached to the task; a returned run shows those of the run. */
  attachments: AttachmentView[];
}

export interface DependencyView {
  kind: 'item' | 'run';
  id: string;
  /** Number of the predecessor task; null when the run is unknown. */
  number: number | null;
  title: string;
  state: DependencyState;
  /** Root of the repository of the item or run; null when the run is unknown. */
  repository: string | null;
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
  pipeline: string;
  pipelineName: string;
  variant: string;
  variantName: string;
  tags: TagView[];
  createdAt: number;
  /** Work groups in a final status out of all work groups; `total` is 0 while the task is split. */
  groups: { done: number; total: number };
  /** Steps passed by the groups out of all their steps, and the step of a single group. */
  steps: StepProgress;
  /** Groups (service steps included) that run or merge now, with the step of their last attempt. */
  active: { group: string; step: string | null; stepName: string | null }[];
  /** Service steps of the run in the order they run: actions, split, message, resolve. */
  system: { kind: SystemStepKind; status: RowStatus; title?: string }[];
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
  /** Tokens of the run so far, live attempts included; null before any usage. */
  usage: Usage | null;
}

export interface QueueView {
  /** The queue of one project; the global mode answers with `GlobalQueueView`. */
  scope: 'project';
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
  /** The take filter: ids of pipelines and of catalog tags; an empty list means any. */
  filter: { pipelines: string[]; tags: string[] };
  /** The tags of the filter that are still in the catalog. */
  filterTags: TagView[];
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

/** A task of the global queue: the task with the project whose queue it stands in. */
export interface GlobalQueueItemView extends QueueItemView {
  /** Root of the project of the task. */
  repository: string;
}

/** A run that occupies a place of the global queue, with its project. */
export interface GlobalQueueRunView extends QueueRunView {
  /** Root of the project of the run. */
  repository: string;
}

/** The one queue of the `global` mode: the tasks and runs of all projects in one order. */
export interface GlobalQueueView extends Omit<
  QueueView,
  | 'scope'
  | 'repository'
  | 'autoDeliver'
  | 'deliveryMode'
  | 'filter'
  | 'filterTags'
  | 'items'
  | 'runs'
  | 'skipped'
> {
  scope: 'global';
  /** Pipeline ids, project paths and tag names; an empty list means any. */
  filter: { pipelines: string[]; projects: string[]; tags: string[] };
  /** The tasks in the global order; `position` is the place among all projects. */
  items: GlobalQueueItemView[];
  runs: GlobalQueueRunView[];
  skipped: GlobalQueueRunView[];
  /** The most specialists working at once on the machine (`queue.max`). */
  max: number;
}

/** One item of a task added to several projects, in the order of the request. */
export interface AddedToProjectView {
  /** Root of the repository. */
  repository: string;
  /** Slug of the project. */
  project: string;
  item: string;
  /** Number of the task in its project. */
  number: number;
}
