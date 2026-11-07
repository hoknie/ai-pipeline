import { type FieldError } from './errors.ts';
import { type ConfigSource } from './merge.ts';
import { type ResolvedConfig } from './settings.ts';

export const CONFIG_DIR = 'aip';

export const SETTINGS_NAME = 'settings';

export const SPECIALISTS_DIR = 'specialists';

export const PIPELINES_DIR = 'pipelines';

/** The old name of the pipelines directory; still read, never created. */
export const LEGACY_PIPELINES_DIR = 'workflows';

export const ACTIONS_DIR = 'actions';

export interface LevelPaths {
  /** Directory with settings.yaml, specialists/, pipelines/ and actions/. */
  directory: string;
  /** Files and directories of the old single-file layout; only used to explain the move. */
  legacy: string[];
}

export interface ConfigPaths {
  global: LevelPaths;
  project: LevelPaths;
}

export interface LoadedConfig {
  config: ResolvedConfig;
  /** Files read, in the order they are merged. */
  files: string[];
  /** Files that still use old names; `aip config check` advises to rename them. */
  legacy?: string[];
}

/** The files of one level as read from disk, before they are put together. */
export interface LevelFiles {
  settings?: ConfigSource;
  specialists: ConfigSource[];
  pipelines: ConfigSource[];
  actions: ConfigSource[];
  /** Problems found while reading, such as `x.yaml` next to `x.yml`. */
  problems: FieldError[];
  /** Files that still use old names: the old pipelines directory and the old `split` key. */
  legacy?: string[];
}

/** The logical tree of a level and the file each part of it comes from. */
export interface Level {
  tree: unknown;
  /** Dotted path in the tree (`swarm.specialists.coder`, `swarm.delivery.mode`) → file. */
  origins: Map<string, string>;
  files: string[];
  problems: FieldError[];
}

export function stem(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.replace(/\.ya?ml$/, '');
}
