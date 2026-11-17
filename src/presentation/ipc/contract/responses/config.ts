import type {
  AccessModels,
  AccessState,
  MatrixCell,
  ProviderStatus,
} from '../../../../feature/agents/types/index.ts';
import type { RoleModels } from '../../../../feature/swarm-config/types/index.ts';

import type {
  ConfigEditorView,
  SharedPipelineUsage,
  SharedPipelinesUsage,
  SharedSpecialistUsage,
  SharedSpecialistsUsage,
} from '../../../../feature/swarm-edit/types/index.ts';

export interface ConfigEditorResponse extends ConfigEditorView {
  repository: string;
}

/** The shared specialists with the repositories of the registry that use them. */
export type SharedSpecialistsView = SharedSpecialistsUsage;

export type SharedSpecialistView = SharedSpecialistUsage;

/** The shared pipelines with the repositories of the registry that use them. */
export type SharedPipelinesView = SharedPipelinesUsage;

export type SharedPipelineView = SharedPipelineUsage;

export type {
  ConfigEditResult,
  ConfigPreview,
  EditorChain,
  PipelinesImportResult,
  PipelinesView,
  SettingLevel,
  SpecialistTagFolderView,
  SpecialistTagsResult,
  SpecialistTagsView,
  SpecialistsImportResult,
  SystemStageSetting,
  SystemStageView,
  SystemStagesView,
} from '../../../../feature/swarm-edit/types/index.ts';

export interface RoleView {
  slug: string;
  name: string;
  level: 'project' | 'global';
}

export interface ProviderView {
  slug: string;
  name: string;
  level: 'project' | 'global';
  /** The file of the provider that applies; null when it is not known. */
  file: string | null;
  enabled: boolean;
  status: ProviderStatus;
  /** Index of the effective access: the first available one; null when there is none. */
  active: number | null;
  /** The routes with their availability and reasons; no value of a variable is here. */
  access: (AccessState & { models: RoleModels })[];
  models: RoleModels;
  /** When the usage-limit hold of the provider lifts (ms of the epoch); null without a hold. */
  limitUntil: number | null;
}

/** Roles, providers with status and the role × provider matrix of a repository. */
export interface ProvidersView {
  repository: string;
  /** The errors of the configuration; the lists are empty when there are any. */
  errors: { file?: string; path: string; message: string }[];
  roles: RoleView[];
  providers: ProviderView[];
  matrix: MatrixCell[];
}

export interface ProviderModelsView {
  repository: string;
  provider: string;
  access: AccessModels[];
}
