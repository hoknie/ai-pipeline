import { AppError } from '../../../platform/errors/index.ts';

import {
  ACTIONS_DIR,
  type FieldError,
  PIPELINES_DIR,
  SPECIALISTS_DIR,
} from '../../swarm-config/types/index.ts';
import { field } from './setting-fields.ts';

export type EntryKind = 'specialist' | 'pipeline' | 'action';

export const KIND_DIRECTORY: Record<EntryKind, string> = {
  specialist: SPECIALISTS_DIR,
  pipeline: PIPELINES_DIR,
  action: ACTIONS_DIR,
};

/** Key of the section of the configuration tree (`swarm.<section>.<id>`) that holds the kind. */
export const KIND_SECTION: Record<EntryKind, 'specialists' | 'pipelines' | 'actions'> = {
  specialist: 'specialists',
  pipeline: 'pipelines',
  action: 'actions',
};

export type EntryLevel = 'project' | 'global' | 'project_over_global';

/** The level a file is written to. */
export type WriteLevel = 'project' | 'global';

/** Thrown for a request that is wrong by itself, before any file is looked at. */
export class ConfigEditError extends AppError {
  constructor(message: string) {
    super('invalid', message, { code: 'config.edit' });
    this.name = 'ConfigEditError';
  }
}

export interface EntryReference {
  pipeline?: string;
  step?: string;
  split?: boolean;
  /** Id of an action (`actions/<id>.yaml`) that runs the specialist. */
  action?: string;
  /** `delivery.resolver` or `delivery.message_specialist`. */
  field?: string;
  /** Pipeline point (`swarm.stages.<point>` or `stages.<point>` of the pipeline) that names an action. */
  point?: string;
  /** Root of the registry repository the reference comes from; set for shared specialists. */
  repository?: string;
}

export interface EditRequest {
  kind: EntryKind;
  id: string;
  /** New content of the file; null deletes it. */
  value: Record<string, unknown> | null;
  /** Revision of the file the caller saw; null when it did not exist. */
  revision: string | null;
  /** Level of the file; `project` when omitted. */
  level?: WriteLevel;
}

export type EditPlan =
  | { ok: true; file: string; text: string | null; revision: string | null }
  | { ok: false; reason: 'invalid'; errors: FieldError[]; references?: EntryReference[] }
  | { ok: false; reason: 'conflict'; message: string };

export type SettingKind =
  'boolean' | 'choice' | 'integer' | 'string' | 'duration' | 'strings' | 'specialist' | 'env';

/** A value the editor writes into settings.yaml; null removes the field. */
export type SettingValue = boolean | number | string | string[] | null;

/** One field of settings.yaml the editor may write. */
export interface SettingField {
  /** Key path in settings.yaml, such as `delivery.mode`. */
  path: string;
  kind: SettingKind;
  /** Allowed values of a `choice`. */
  options?: readonly string[];
  /** Inclusive bounds of an `integer`. */
  range?: readonly [number, number];
  /** Read only from the shared settings.yaml (`web.*`, `runtimes.*`). */
  globalOnly: boolean;
}

export interface SettingRequest {
  path: string;
  /** New value; null removes the field. */
  value: SettingValue;
  /** Revision of settings.yaml the caller saw; null when it did not exist. */
  revision: string | null;
  level?: WriteLevel;
}

export interface SettingsRequest {
  /** New values by path; null removes the field. */
  values: Record<string, SettingValue>;
  /** Revision of settings.yaml the caller saw; null when it did not exist. */
  revision: string | null;
  level?: WriteLevel;
}

export interface EditCommitted {
  file: string;
  revision: string | null;
}

/** One file of an entry on one level. */
export interface EntrySource {
  file: string;
  revision: string;
  raw: Record<string, unknown>;
}

export type EntrySources = { project?: EntrySource; global?: EntrySource };

/** A specialist in the editor: where it lives and what its files say. */
export interface EditorSpecialist {
  slug: string;
  level: EntryLevel;
  /** The file that applies: the project one when there is one. */
  file: string;
  /** Revision of the project file; null when the specialist has none in the project. */
  revision: string | null;
  /** Values as the applying file has them. */
  raw: Record<string, unknown>;
  /** The file of each level the specialist has. */
  sources: EntrySources;
  /** Values after defaults; null when the specialist does not pass validation. */
  effective: EditorSpecialistValues | null;
  /** Tags of the shared file (read only here); empty when it has none or they are not valid. */
  shared_tags: string[];
  /** Tags of the project file. */
  own_tags: string[];
}

export interface EditorSpecialistValues {
  name: string;
  runtime: string;
  model: string | null;
  permissions: string;
  timeout: string;
  allow_commands: string[];
  tools: string[];
  skills: string[];
  prompt: string | null;
  max: number | null;
}

/** A pipeline in the editor: where it lives and what its files say. */
export interface EditorPipeline {
  id: string;
  level: EntryLevel;
  file: string;
  revision: string | null;
  raw: Record<string, unknown>;
  sources: EntrySources;
  /** Tags of the shared file; empty when it has none or they are not valid. */
  shared_tags: string[];
  /** Tags of the project file. */
  own_tags: string[];
}

/** An action in the editor: where it lives and what its files say. */
export interface EditorAction {
  id: string;
  level: EntryLevel;
  file: string;
  revision: string | null;
  raw: Record<string, unknown>;
  sources: EntrySources;
}

export interface EditorSetting {
  /** Key path in settings.yaml, such as `delivery.mode`. */
  path: string;
  value: unknown;
  /** File the value comes from; null for a built-in default. */
  file: string | null;
  kind: SettingKind;
  options?: readonly string[];
  range?: readonly [number, number];
  /** Read only from the shared settings.yaml. */
  globalOnly: boolean;
  /** The built-in default. */
  defaultValue: unknown;
  /** The value of the global level alone, without the project. */
  globalValue: unknown;
  /** What each settings.yaml says itself; a key that is not there is absent. For `env`, only names. */
  written: { global?: unknown; project?: unknown };
}

export interface SettingsFileView {
  file: string;
  /** Revision of the file; null when it does not exist. */
  revision: string | null;
}

export interface ConfigEditorView {
  directories: { global: string; project: string };
  settingsFiles: { global: SettingsFileView; project: SettingsFileView };
  specialists: EditorSpecialist[];
  pipelines: EditorPipeline[];
  actions: EditorAction[];
  settings: EditorSetting[];
  errors: FieldError[];
}

export function key(error: FieldError): string {
  return `${error.path}\u0000${error.message}`;
}
