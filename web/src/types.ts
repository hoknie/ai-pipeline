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
}

/** Changes of a queued task; `title: null` removes the title. */
export interface QueuePatch {
  workflow?: string;
  task?: string;
  groups?: { title: string; task: string }[];
  title?: string | null;
  /** `null`: follow `delivery.auto` again. */
  autoDeliver?: boolean | null;
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
