import type { PipelineTopology, StagePerformer } from '../../runs/types/index.ts';
import type { FieldError } from '../../swarm-config/types/index.ts';

import type { EntryReference } from './editor.ts';
import type { SpecialistTagFolder } from './tag-folders.ts';

/** Where the value of a setting comes from: the built-in default, the shared level or the project. */
export type SettingLevel = 'default' | 'global' | 'project';

/** A setting of a built-in stage with the level that sets it. */
export interface SystemStageSetting {
  /** Key path in settings.yaml, such as `delivery.resolver_prompt`. */
  path: string;
  value: unknown;
  level: SettingLevel;
}

/** A built-in stage of the pipeline that is not an action: its task and its settings. */
export interface SystemStageView {
  kind: 'split' | 'message' | 'delivery' | 'resolve';
  name: string;
  /** Who runs the stage; null when it depends on the pipeline (the split). */
  performer: StagePerformer | null;
  /** The built-in task of the specialist; null for a stage without one. */
  task: string | null;
  settings: SystemStageSetting[];
}

export interface SystemStagesView {
  repository: string;
  stages: SystemStageView[];
  /** Problems of the configuration; the list of stages is empty when there are any. */
  errors: { file?: string; path: string; message: string }[];
}

export interface PipelinesView {
  repository: string;
  pipelines: PipelineTopology[];
  /** Problems of the configuration; the list of pipelines is empty when there are any. */
  errors: { file?: string; path: string; message: string }[];
}

/** The graph of a draft pipeline, or the errors that keep it from being built. */
export interface ConfigPreview {
  topology: PipelineTopology | null;
  errors: FieldError[];
}

/** The outcome of a write or delete; problems with the edit are a result, not an IPC error. */
export type ConfigEditResult =
  | { ok: true; revision: string | null; file: string }
  | { ok: false; reason: 'invalid'; errors: FieldError[]; references?: EntryReference[] }
  | { ok: false; reason: 'conflict'; message: string };

/** The specialists of one level with their tags; `repository` is null for the shared level. */
export interface SpecialistTagFolderView extends SpecialistTagFolder {
  repository: string | null;
}

export interface SpecialistTagsView {
  folders: SpecialistTagFolderView[];
}

/** The outcome of a tag edit: the folder of the level as it is now, or why nothing was written. */
export type SpecialistTagsResult =
  | { ok: true; folder: SpecialistTagFolderView }
  | { ok: false; reason: 'invalid'; errors: FieldError[] }
  | { ok: false; reason: 'conflict'; message: string; slugs?: string[] };

/** The outcome of an import: the slugs that were copied, or why nothing was. */
export type SpecialistsImportResult =
  | { ok: true; imported: string[] }
  | { ok: false; reason: 'invalid'; errors: FieldError[] }
  | { ok: false; reason: 'conflict'; message: string; slugs?: string[] };

/** The outcome of a pipeline import: the ids that were copied, or why nothing was. */
export type PipelinesImportResult =
  | { ok: true; imported: string[] }
  | { ok: false; reason: 'invalid'; errors: FieldError[] }
  | { ok: false; reason: 'conflict'; message: string; ids?: string[] };
