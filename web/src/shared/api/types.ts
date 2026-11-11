export type {
  ApplyResult,
  CatalogEntry,
  ConfigCatalogResponse,
  ConfigEditResult,
  ConfigEditorResponse,
  ConfigPreview,
  EditorChain,
  SharedSpecialistView,
  SharedSpecialistsView,
  SharedPipelineView,
  SharedPipelinesView,
  PipelinesImportResult,
  SpecialistTagFolderView,
  SpecialistTagsResult,
  SpecialistTagsView,
  SpecialistsImportResult,
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
  ArtifactView,
  RunPatchView,
  GroupRow,
  GroupWait,
  DeliveryStage,
  RowStatus,
  SystemStepKind,
  SystemStepRow,
  SystemStageSetting,
  SystemStageView,
  SystemStagesView,
  SettingLevel,
  PipelineStage,
  StageCondition,
  StageKind,
  StagePerformer,
  StageSection,
  StageStatus,
  GroupSpecView,
  GroupView,
  QueueItemView,
  QueueRunView,
  QueueView,
  RepositoryView,
  RunCreated,
  RunViewState,
  ResolverRow,
  RunView,
  RuntimeCatalog,
  StepGroup,
  StepState,
  StepTopology,
  TagView,
  Topology,
  PipelineTopology,
  PipelinesView,
  Transcript,
  TranscriptEntry,
} from '../../../../src/presentation/ipc/contract/index.ts';

import type {
  ChainMode,
  ChainRuntimeItem,
  DeliveryMode,
  ReasoningEffort,
  RuntimeChain,
} from '../../../../src/feature/swarm-config/types/index.ts';
import type { TagColor } from '../../../../src/feature/tags/types/index.ts';

export type { ChainMode, ChainRuntimeItem, DeliveryMode, ReasoningEffort, RuntimeChain, TagColor };
import type {
  DaemonCheck,
  DependencyView,
  QueueItemView,
} from '../../../../src/presentation/ipc/contract/index.ts';

/** State of a predecessor: done, still pending or blocked. */
export type DependencyState = DependencyView['state'];

/** Whether a queued task can start now. */
export type ItemReadiness = QueueItemView['readiness'];

/** Build mismatch between the daemon and `aip web`; null when they run the same build. */
export type DaemonMismatch = DaemonCheck['mismatch'];

/** Fields of a task in the queue: either `task` or `groups`. */
export interface QueueFields {
  pipeline: string;
  task?: string;
  groups?: { title: string; task: string }[];
  title?: string;
  /** Only `true` is sent: the task is added postponed. */
  postponed?: boolean;
  /** Absent: follow `delivery.auto` when the task starts. */
  autoDeliver?: boolean;
  /** Absent: follow `delivery.mode` when the task starts. */
  deliveryMode?: DeliveryMode;
  /** Tag names. */
  tags?: string[];
  /** Ids of pipeline steps the task skips. */
  skip?: string[];
  /** Ids of queue items and runs the task waits for. */
  after?: string[];
  /** Run id or task number; the task gets the linked task tag of that run. */
  parent?: string | null;
}

/** Changes of a queued task; `title: null` removes the title. */
export interface QueuePatch {
  pipeline?: string;
  task?: string;
  groups?: { title: string; task: string }[];
  title?: string | null;
  /** `null`: follow `delivery.auto` again. */
  autoDeliver?: boolean | null;
  /** `null`: follow `delivery.mode` again. */
  deliveryMode?: DeliveryMode | null;
  /** Tag names; replaces the tags of the item. */
  tags?: string[];
  /** Ids of pipeline steps to skip; replaces the list of the item. */
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
  SpecialistTagEntry,
  EditorPipeline,
  EntryLevel,
  EntryReference,
  EntrySource,
  EntrySources,
  SettingKind,
  SettingValue,
  WriteLevel,
} from '../../../../src/feature/swarm-edit/types/index.ts';
export type { FieldError } from '../../../../src/feature/swarm-config/types/index.ts';

/** The network the daemon holds; the proxy has no login and password. */
export interface NetworkStatus {
  state: 'off' | 'up' | 'down';
  problem: string | null;
  checkedAt: number | null;
  since: number;
  proxy: string | null;
}

/** What `GET /api/system` answers: the daemon, the panel, the network and the daemon log. */
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
    /**
     * `standalone`: started by `aip web`, it cannot restart itself; `standby`: serves the panel
     * while the daemon is stopped and can start it again.
     */
    servedBy: 'daemon' | 'standalone' | 'standby';
  };
  /** The network the daemon holds; null while the daemon is not running. */
  network: NetworkStatus | null;
  logPath: string | null;
}
