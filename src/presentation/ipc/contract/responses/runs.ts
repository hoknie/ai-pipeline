import type { HumanDecision, Usage } from '../../../../feature/agents/types/index.ts';
import type {
  GroupDelivery,
  GroupStatus,
  GroupWait,
  HumanOnly,
  HumanQuestion,
  Incident,
  RunCreated,
  RunHold,
  RunPhase,
  SpecialistUse,
  StepState,
  Topology,
} from '../../../../feature/runs/types/index.ts';
import type { ActionPoint, DeliveryMode } from '../../../../feature/swarm-config/types/index.ts';
import type { AttachmentView } from './attachments.ts';
import type { QueueView } from './queue.ts';
import type { TagView } from './tags.ts';

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
  /** Commit range `<from>..<to>` the statistics were taken from; changes with every new commit. */
  revision: string;
}

export interface DiffTotals {
  files: number;
  added: number;
  removed: number;
}

/** Diff statistics of a group by slug, when known. */
export type DiffLookup = (slug: string) => DiffStat | null;

export type { GroupWait } from '../../../../feature/runs/types/index.ts';

/** Status of a row: the stored one, `done` for a merged service step, or the derived `waiting`. */
export type RowStatus = GroupStatus | 'done' | 'waiting' | RunHold;

/** Why a queued group is not started yet, by run and group slug; null when it is not held back. */
export type WaitLookup = (run: string, slug: string) => GroupWait | null;

/** Number of artifacts per group slug of one run. */
export type ArtifactCounts = ReadonlyMap<string, { count: number; revision: number }>;

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
  /** Revision of the group's changes (`DiffStat.revision`); null while the statistics are unknown. */
  diffRevision: string | null;
  /** The group waits in `queued` until its runtime's usage limit resets (ms); null otherwise. */
  limitUntil: number | null;
  /** Tokens and cost of all attempts of the group so far, live ones included. */
  usage: Usage | null;
  /** Answers accepted for the group, oldest first. */
  decisions: ViewDecision[];
  /** Artifacts the specialists published for the group. */
  artifacts: number;
  /** Changes whenever an artifact of the group is published or replaced. */
  artifactsRevision: number;
}

/** An accepted answer as the protocol shows it. */
export type ViewDecision = HumanDecision;

/** An accepted answer in the overview of a run, with the slug of its group. */
export type RunDecision = ViewDecision & { group: string };

export interface SplitRow {
  status: RowStatus;
  wait: GroupWait | null;
  question: string | null;
  questions: HumanQuestion[] | null;
  humanOnly: HumanOnly | null;
  reason: string | null;
}

export type SystemStepKind = 'split' | 'message' | 'resolve' | 'repair' | 'action';

/** A service step of the run (split, commit message, delivery resolver, pipeline action). */
export interface SystemStepRow extends Omit<GroupRow, 'status'> {
  kind: SystemStepKind;
  status: RowStatus;
  /** Point of the pipeline of an action; absent for other steps. */
  point?: ActionPoint;
  /** Id of the action in the catalog; absent for other steps. */
  action?: string;
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
export type RunViewState = RunPhase | 'queued' | 'repair' | RunHold;

/** The observer repairs of a run. */
export interface RunRepairView {
  /** An observer may take the incidents of the run. */
  allowed: boolean;
  /** The run is in the state `repair`: an observer repairs it or will when a worker is free. */
  active: boolean;
  /** Repairs started for the run. */
  repairs: number;
  /** The incident being repaired; null when none is. */
  incident: Incident | null;
  /** Why the observer cancelled the whole run; null when it did not. */
  cancelReason: string | null;
}

export interface RunView {
  id: string;
  /** Integer number of the task within the repository. */
  number: number;
  title: string;
  /** English kebab-case name; null until the run is named. */
  name: string | null;
  repository: string;
  pipeline: string;
  /** Display name of the pipeline in the configuration of the run. */
  pipelineName: string;
  /** Id of the pipeline variant of the run; `default` for the pipeline as it is. */
  variant: string;
  /** Name of the variant in the configuration of the run; the id without a name. */
  variantName: string;
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
  /** Files attached to the task of the run. */
  attachments: AttachmentView[];
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
  /** Steps of the pipeline with the groups on them, for the topology view. */
  topology: Topology;
  /** Each step of the group pipeline: passed, under way or ahead, and whether it is skipped. */
  steps: StepState[];
  /** Specialists that run or are waited for in the run, for the load across the machine. */
  specialists: SpecialistUse[];
  groups: GroupRow[];
  /** Service steps in the order split, message, resolve; absent steps are left out. */
  system: SystemStepRow[];
  /** Answers accepted in the run (human and autopilot): split, work groups, message, resolve. */
  decisions: RunDecision[];
  /** Observer repairs of the run; `runView` always sets it. */
  repair?: RunRepairView;
}

export interface ResolverRow {
  status: GroupStatus | 'waiting';
  wait: GroupWait | null;
  round: number;
  rounds: number;
  conflicts: string[];
  reason: string | null;
}

export type { RunCreated } from '../../../../feature/runs/types/index.ts';

/** Answer to `run`: the task goes to the queue; the run exists once the queue takes the task. */
export interface RunQueued {
  item: string;
  /** Number given to the task. */
  number: number;
  run: RunCreated | null;
  queue: QueueView;
}

export type {
  SpecialistUse,
  StepGroup,
  StepInfo,
  StepState,
  StepTopology,
  Topology,
  PipelineTopology,
  PipelineStage,
  StageCondition,
  StageKind,
  StagePerformer,
  StageSection,
  StageStatus,
} from '../../../../feature/runs/types/index.ts';

export type { ApplyResult } from '../../../../feature/delivery/types/index.ts';
