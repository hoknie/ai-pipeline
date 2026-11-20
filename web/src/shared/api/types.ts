export type {
  ApplyResult,
  CatalogEntry,
  ChannelStateView,
  ConnectionView,
  DeliveryView,
  IntegrationSenderView,
  IntegrationTypeView,
  RegistrySkillView,
  ProjectLinkView,
  SubscriptionView,
  WebhookAttemptView,
  WebhookDeliveryView,
  WebhookTestView,
  WebhookView,
  ConfigCatalogResponse,
  ConfigModelsResponse,
  ModelEntry,
  RuntimeModels,
  ConfigEditResult,
  ConfigEditorResponse,
  ConfigPreview,
  ProviderModelsView,
  ProviderView,
  ProvidersView,
  RoleView,
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
  AuditEventView,
  AuthorView,
  BackgroundOwner,
  BackgroundProcessesView,
  BackgroundProcessView,
  DaemonCheck,
  DiffStat,
  DiffTotals,
  FileDiffView,
  FileStat,
  ArtifactView,
  AttachmentView,
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
  GlobalQueueItemView,
  GlobalQueueRunView,
  GlobalQueueView,
  QueueItemView,
  QueueRunView,
  QueueView,
  RepositoryView,
  RunCreated,
  RunViewState,
  ResolverRow,
  RunView,
  RuntimeCatalog,
  StatsClearView,
  StatsReportView,
  UserDirectoryEntry,
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
import type { LinkInput, TaskLinkView } from '../../../../src/feature/queue/types/index.ts';

export type {
  ChainMode,
  ChainRuntimeItem,
  DeliveryMode,
  ReasoningEffort,
  RuntimeChain,
  TagColor,
  LinkInput,
  TaskLinkView,
};
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

/** One task for several projects: the shared fields, an addition per project, a shared tag. */
export interface QueueProjectsFields {
  /** Paths of the projects, in the order of the chain. */
  repositories: string[];
  pipeline: string;
  variant?: string;
  provider?: string;
  task: string;
  title?: string;
  postponed?: boolean;
  /** Only `true` is sent: the task is added where its copy already waits. */
  allowDuplicate?: boolean;
  autoDeliver?: boolean;
  deliveryMode?: DeliveryMode;
  skip?: string[];
  after?: string[];
  /** Additions to the text by project path. */
  notes?: Record<string, string>;
  /** Name of the tag every project gets from its catalog. */
  tag?: string;
  /** The task of each project waits for the one of the previous project. */
  chain?: boolean;
}

/** The item a task of several projects got in one project. */
export interface AddedToProject {
  repository: string;
  project: string;
  item: string;
  number: number;
}

/** Fields of a task in the queue: either `task` or `groups`. */
export interface QueueFields {
  pipeline: string;
  /** Id of a variant of the pipeline; absent: `default`. */
  variant?: string;
  /** Id of a provider of the tiers; absent: none. */
  provider?: string | null;
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
  links?: LinkInput[];
  /** Run id or task number; the task gets the linked task tag of that run. */
  parent?: string | null;
  /** Only `true` is sent: a new task is added though its copy already waits in the queue. */
  allowDuplicate?: boolean;
  /** Ids of the files uploaded before; they become the attachments of the task. */
  uploads?: string[];
  /** Names of attachments to remove; an edit only. */
  detach?: string[];
}

/** Changes of a queued task; `title: null` removes the title. */
export interface QueuePatch {
  pipeline?: string;
  /** Id of a variant of the pipeline. */
  variant?: string;
  /** Id of a provider of the tiers; `null` clears it. */
  provider?: string | null;
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
  links?: LinkInput[];
  /** Run id or task number; `null` removes the linked task tags. */
  parent?: string | null;
  /** A running queue does not take a postponed task. */
  postponed?: boolean;
  position?: number;
  /** Ids of uploaded files to attach. */
  uploads?: string[];
  /** Names of attachments to remove. */
  detach?: string[];
}
export type {
  EditorMcpServer,
  EditorMcpServerValues,
  EditorProvider,
  McpServerValue,
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
export type {
  AccessModels,
  AccessState,
  MatrixCell,
  ModelEntry as ProviderModelEntry,
  ProviderStatus,
} from '../../../../src/feature/agents/types/index.ts';
export type { RoleModel, RoleModels } from '../../../../src/feature/swarm-config/types/index.ts';

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
  /** `server` when several people sign in; `me` is the signed in user then. */
  mode?: 'local' | 'server';
  me?: { email: string; name: string; admin: boolean } | null;
  attachments: { s3Credentials: boolean };
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

export type { StatsBucket, StatsBucketRequest } from './statsApi.ts';

/** What the signed in user may do in a project; the answer of `GET /api/access/me`. */
export interface AccessMe {
  actor: 'local' | 'system' | 'user';
  userId: string | null;
  repository: string | null;
  actions: string[];
  /** The actions allowed only for a resource the user is the author of. */
  conditional: string[];
  /** The paths of the projects the user reads; `null`: all of them. */
  repositories: string[] | null;
}
