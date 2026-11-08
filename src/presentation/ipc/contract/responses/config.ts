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
