export type {
  ApplyResult,
  CatalogEntry,
  ConfigCatalogResponse,
  ConfigEditResult,
  ConfigPreview,
  ConfigEditorResponse,
  AttemptView,
  DaemonCheck,
  DiffStat,
  DiffTotals,
  FileStat,
  GroupRow,
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

import type { DaemonCheck } from '../../src/protocol/index.ts';

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
  /** Tag names. */
  tags?: string[];
  /** Ids of workflow steps the task skips. */
  skip?: string[];
}

/** Changes of a queued task; `title: null` removes the title. */
export interface QueuePatch {
  workflow?: string;
  task?: string;
  groups?: { title: string; task: string }[];
  title?: string | null;
  /** `null`: follow `delivery.auto` again. */
  autoDeliver?: boolean | null;
  /** Tag names; replaces the tags of the item. */
  tags?: string[];
  /** Ids of workflow steps to skip; replaces the list of the item. */
  skip?: string[];
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
