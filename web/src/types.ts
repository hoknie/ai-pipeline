export type {
  ApplyResult,
  CatalogEntry,
  ConfigCatalogResponse,
  ConfigEditResult,
  ConfigPreview,
  ConfigEditorResponse,
  DependencyView,
  AttemptView,
  DaemonCheck,
  DiffStat,
  DiffTotals,
  FileStat,
  GroupRow,
  SystemStepKind,
  SystemStepRow,
  GroupView,
  QueueItemView,
  QueueRunView,
  QueueView,
  RepositoryView,
  RunCreated,
  ResolverRow,
  RunView,
  RuntimeCatalog,
  StepGroup,
  StepTopology,
  TagColor,
  TagView,
  Topology,
  WorkflowTopology,
  WorkflowsView,
  Transcript,
  TranscriptEntry,
} from '../../src/protocol/index.ts';

import type { DeliveryMode } from '../../src/config/index.ts';
import type { DaemonCheck, DependencyView, QueueItemView } from '../../src/protocol/index.ts';

/** State of a predecessor: done, still pending or blocked. */
export type DependencyState = DependencyView['state'];

/** Whether a queued task can start now. */
export type ItemReadiness = QueueItemView['readiness'];

/** Build mismatch between the daemon and `aip web`; null when they run the same build. */
export type DaemonMismatch = DaemonCheck['mismatch'];

/** Fields of a task in the queue: either `task` or `groups`. */
export interface QueueFields {
  workflow: string;
  task?: string;
  groups?: { title: string; task: string }[];
  title?: string;
  /** Absent: follow `delivery.auto` when the task starts. */
  autoDeliver?: boolean;
  /** Absent: follow `delivery.mode` when the task starts. */
  deliveryMode?: DeliveryMode;
  /** Tag names. */
  tags?: string[];
  /** Ids of workflow steps the task skips. */
  skip?: string[];
  /** Ids of queue items and runs the task waits for. */
  after?: string[];
}

/** Changes of a queued task; `title: null` removes the title. */
export interface QueuePatch {
  workflow?: string;
  task?: string;
  groups?: { title: string; task: string }[];
  title?: string | null;
  /** `null`: follow `delivery.auto` again. */
  autoDeliver?: boolean | null;
  /** `null`: follow `delivery.mode` again. */
  deliveryMode?: DeliveryMode | null;
  /** Tag names; replaces the tags of the item. */
  tags?: string[];
  /** Ids of workflow steps to skip; replaces the list of the item. */
  skip?: string[];
  /** Ids of queue items and runs the task waits for; replaces the list of the item. */
  after?: string[];
  /** A running queue does not take a postponed task. */
  postponed?: boolean;
  position?: number;
}
export type {
  EditorSetting,
  EditorSpecialist,
  EditorSpecialistValues,
  EditorWorkflow,
  EntryLevel,
  EntryReference,
  EntrySource,
  EntrySources,
  FieldError,
  WriteLevel,
} from '../../src/config/index.ts';
