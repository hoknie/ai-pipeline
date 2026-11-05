export type {
  ApplyResult,
  CatalogEntry,
  ConfigCatalogResponse,
  ConfigEditResult,
  ConfigPreview,
  ConfigEditorResponse,
  DependencyView,
  AttemptView,
  BackgroundOwner,
  BackgroundProcessesView,
  BackgroundProcessView,
  DaemonCheck,
  DiffStat,
  DiffTotals,
  FileDiffView,
  FileStat,
  RunPatchView,
  GroupRow,
  GroupWait,
  DeliveryStage,
  RowStatus,
  SystemStepKind,
  SystemStepRow,
  GroupSpecView,
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
  StepState,
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
  /** Run id or task number; the task gets the linked task tag of that run. */
  parent?: string | null;
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
  /** Run id or task number; `null` removes the linked task tags. */
  parent?: string | null;
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
  SettingKind,
  SettingValue,
  WriteLevel,
} from '../../src/config/index.ts';

/** What `GET /api/system` answers: the daemon, the panel and the daemon log. */
export interface SystemView {
  daemon: {
    running: boolean;
    pid: number | null;
    version: string | null;
    build: string | null;
    busy: boolean | null;
    /** The side that runs the older build when the builds differ. */
    mismatch: 'daemon' | 'client' | null;
  };
  web: {
    running: true;
    pid: number;
    /** Address without the access token. */
    url: string;
    host: string;
    port: number;
    auth: 'token' | 'none';
    version: string;
    build: string;
    /** `standalone`: started by `aip web`, it cannot restart itself. */
    servedBy: 'daemon' | 'standalone';
  };
  logPath: string | null;
}
