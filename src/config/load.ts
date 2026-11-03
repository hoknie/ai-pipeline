import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseDocument } from 'yaml';

import {
  SETTINGS_NAME,
  SPECIALISTS_DIR,
  WORKFLOWS_DIR,
  type ConfigPaths,
  type LevelPaths,
} from './discover.ts';
import { ConfigLoadError, type FieldError } from './errors.ts';
import { isMapping, KEYED_SECTIONS, mergeConfigs, type ConfigSource } from './merge.ts';
import {
  defaultRuntimes,
  defaultWeb,
  type ResolvedConfig,
  type RuntimeSettings,
  type WebSettings,
} from './model.ts';
import { validateConfig, validateRuntimesSection, validateWebSection } from './validate.ts';

export interface LoadedConfig {
  config: ResolvedConfig;
  /** Files read, in the order they are merged. */
  files: string[];
}

/** The files of one level as read from disk, before they are put together. */
export interface LevelFiles {
  settings?: ConfigSource;
  specialists: ConfigSource[];
  workflows: ConfigSource[];
  /** Problems found while reading, such as `x.yaml` next to `x.yml`. */
  problems: FieldError[];
}

/** The logical tree of a level and the file each part of it comes from. */
export interface Level {
  tree: unknown;
  /** Dotted path in the tree (`swarm.specialists.coder`, `swarm.delivery.mode`) → file. */
  origins: Map<string, string>;
  files: string[];
  problems: FieldError[];
}

export function loadConfig(paths: ConfigPaths): ResolvedConfig {
  return loadConfigSources(paths).config;
}

export function levelIsEmpty(files: LevelFiles): boolean {
  return (
    files.settings === undefined &&
    files.specialists.length === 0 &&
    files.workflows.length === 0 &&
    files.problems.length === 0
  );
}

export function loadConfigSources(paths: ConfigPaths): LoadedConfig {
  const global = readLevel(paths.global);
  const project = readLevel(paths.project);
  const levels: [LevelPaths, LevelFiles][] = [
    [paths.project, project],
    [paths.global, global],
  ];
  for (const [level, files] of levels) {
    if (!levelIsEmpty(files)) continue;
    const found = level.legacy.find((path) => existsSync(path));
    if (found !== undefined) {
      throw new ConfigLoadError({ kind: 'legacy', found, expected: level.directory });
    }
  }
  if (levelIsEmpty(global) && levelIsEmpty(project)) {
    throw new ConfigLoadError({
      kind: 'no_files',
      expected: [paths.global.directory, paths.project.directory],
    });
  }
  return resolveLevels(assembleLevel(global), assembleLevel(project));
}

/** One project level without a global one, built from texts; keys are file names without extension. */
export function configFromFiles(files: {
  settings?: string;
  specialists?: Record<string, string>;
  workflows?: Record<string, string>;
}): ResolvedConfig {
  const source = (path: string, text: string): ConfigSource => ({
    path,
    value: parseYaml(text, path),
  });
  const level = assembleLevel({
    ...(files.settings === undefined
      ? {}
      : { settings: source(`${SETTINGS_NAME}.yaml`, files.settings) }),
    specialists: Object.entries(files.specialists ?? {}).map(([name, text]) =>
      source(`${SPECIALISTS_DIR}/${name}.yaml`, text),
    ),
    workflows: Object.entries(files.workflows ?? {}).map(([name, text]) =>
      source(`${WORKFLOWS_DIR}/${name}.yaml`, text),
    ),
    problems: [],
  });
  return resolveLevels(emptyLevel(), level).config;
}

export function parseConfig(text: string, path = '<inline>'): ResolvedConfig {
  const value = parseYaml(text, path) ?? null;
  const result = validateConfig(value);
  if (!result.ok) throw new ConfigLoadError({ kind: 'invalid', errors: result.errors });
  return result.config;
}

function emptyLevel(): Level {
  return { tree: undefined, origins: new Map(), files: [], problems: [] };
}

function stem(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.replace(/\.ya?ml$/, '');
}

/** The tree `{ swarm: … }` of a level; the stem of a file name is the slug or id of its entry. */
export function assembleLevel(files: LevelFiles): Level {
  const origins = new Map<string, string>();
  const problems = [...files.problems];
  const swarm: Record<string, unknown> = {};
  const settingsFile = files.settings?.path;
  if (settingsFile !== undefined) origins.set('swarm', settingsFile);
  const value = files.settings?.value;
  if (settingsFile !== undefined && value !== undefined) {
    if (!isMapping(value)) {
      problems.push({ file: settingsFile, path: 'swarm', message: 'must be a mapping' });
    } else {
      for (const [key, field] of Object.entries(value)) {
        if (key === 'specialists' || key === 'workflows') {
          problems.push({
            file: settingsFile,
            path: `swarm.${key}`,
            message: `${key} are files of the ${key}/ directory, not a key of settings`,
          });
          continue;
        }
        swarm[key] = field;
        origins.set(`swarm.${key}`, settingsFile);
        if (KEYED_SECTIONS.has(key) && isMapping(field)) {
          for (const name of Object.keys(field)) origins.set(`swarm.${key}.${name}`, settingsFile);
        }
      }
    }
  }
  const entries = (section: string, sources: ConfigSource[]): void => {
    if (sources.length === 0) return;
    const map: Record<string, unknown> = {};
    for (const source of sources) {
      const name = stem(source.path);
      map[name] = source.value === undefined ? null : source.value;
      origins.set(`swarm.${section}.${name}`, source.path);
    }
    swarm[section] = map;
  };
  entries('specialists', files.specialists);
  entries('workflows', files.workflows);
  const present =
    files.settings !== undefined || files.specialists.length + files.workflows.length > 0;
  return {
    tree: present ? { swarm } : undefined,
    origins,
    files: [
      ...(settingsFile === undefined ? [] : [settingsFile]),
      ...files.specialists.map((source) => source.path),
      ...files.workflows.map((source) => source.path),
    ],
    problems,
  };
}

function depthOf(path: string): number {
  return path.split('.').length;
}

function dropPrefix(origins: Map<string, string>, prefix: string): void {
  for (const key of [...origins.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}.`)) origins.delete(key);
  }
}

/** The file each part of the merged tree comes from. */
export function mergeOrigins(global: Level, project: Level): Map<string, string> {
  const origins = new Map(global.origins);
  const globalSwarm = isMapping(global.tree) ? global.tree.swarm : undefined;
  const projectSwarm = isMapping(project.tree) ? project.tree.swarm : undefined;
  if (projectSwarm !== undefined) origins.delete('swarm');
  for (const key of project.origins.keys()) {
    const parts = key.split('.');
    if (parts.length === 2 && parts[1] !== undefined) {
      const section = parts[1];
      const merges =
        KEYED_SECTIONS.has(section) &&
        isMapping(isMapping(globalSwarm) ? globalSwarm[section] : undefined) &&
        isMapping(isMapping(projectSwarm) ? projectSwarm[section] : undefined);
      if (!merges) dropPrefix(origins, key);
    } else if (depthOf(key) === 3) {
      dropPrefix(origins, key);
    }
  }
  for (const [key, file] of project.origins) origins.set(key, file);
  return origins;
}

function fileOf(origins: Map<string, string>, path: string): string | undefined {
  let best: string | undefined;
  let length = -1;
  for (const [key, file] of origins) {
    if ((path === key || path.startsWith(`${key}.`)) && key.length > length) {
      best = file;
      length = key.length;
    }
  }
  return best;
}

/** Sections that only the global level may set. */
const GLOBAL_ONLY_SECTIONS = ['web', 'runtimes'];

/** Merges the global level with the project one and validates the result. */
export function resolveLevels(global: Level, project: Level): LoadedConfig {
  const origins = mergeOrigins(global, project);
  const problems = [...global.problems, ...project.problems];
  const projectSwarm = isMapping(project.tree) ? project.tree.swarm : undefined;
  for (const section of GLOBAL_ONLY_SECTIONS) {
    if (!isMapping(projectSwarm) || !(section in projectSwarm)) continue;
    const file = project.origins.get(`swarm.${section}`);
    problems.push({
      ...(file === undefined ? {} : { file }),
      path: `swarm.${section}`,
      message: `${section} is set only in the global aip/ directory`,
    });
  }
  const result = validateConfig(mergeConfigs(global.tree, project.tree) ?? null);
  const errors = [
    ...problems,
    ...(result.ok
      ? []
      : result.errors.map((error) => {
          const file = fileOf(origins, error.path);
          return file === undefined ? error : { file, ...error };
        })),
  ];
  if (errors.length > 0 || !result.ok) throw new ConfigLoadError({ kind: 'invalid', errors });
  const projectSpecialists = isMapping(projectSwarm) ? projectSwarm.specialists : undefined;
  const config: ResolvedConfig = {
    ...result.config,
    specialists: result.config.specialists.map((specialist) =>
      isMapping(projectSpecialists) && specialist.slug in projectSpecialists
        ? specialist
        : { ...specialist, level: 'global' },
    ),
  };
  return { config, files: [...global.files, ...project.files] };
}

/**
 * One section of the global settings.yaml, validated alone; errors in other fields and files do
 * not matter. Without the file or the section the defaults apply.
 */
function loadGlobalSection<T>(
  paths: ConfigPaths,
  section: string,
  defaults: () => T,
  validate: (value: unknown) => { value: T; errors: FieldError[] },
): T {
  const directory = paths.global.directory;
  const names = listYaml(directory, SETTINGS_NAME);
  const [first, second] = names;
  if (first !== undefined && second !== undefined) {
    throw new ConfigLoadError({
      kind: 'invalid',
      errors: [
        {
          file: join(directory, first),
          path: 'swarm',
          message: `defined by two files, ${join(directory, first)} and ${join(directory, second)}; keep one`,
        },
      ],
    });
  }
  if (first === undefined) return defaults();
  const file = join(directory, first);
  const read = readYaml(file);
  if (!read.found || !isMapping(read.value)) return defaults();
  const { value, errors } = validate(read.value[section]);
  if (errors.length > 0) {
    throw new ConfigLoadError({
      kind: 'invalid',
      errors: errors.map((error) => ({ file, ...error })),
    });
  }
  return value;
}

/** Web panel settings from the global settings.yaml only. */
export function loadWebSettings(paths: ConfigPaths): WebSettings {
  return loadGlobalSection(paths, 'web', defaultWeb, (value) => {
    const { web, errors } = validateWebSection(value);
    return { value: web, errors };
  });
}

/** Agent CLI commands from the global settings.yaml only. */
export function loadRuntimeSettings(paths: ConfigPaths): RuntimeSettings {
  return loadGlobalSection(paths, 'runtimes', defaultRuntimes, (value) => {
    const { runtimes, errors } = validateRuntimesSection(value);
    return { value: runtimes, errors };
  });
}

/** Reads settings.yaml, specialists/*.yaml and workflows/*.yaml of a level directory. */
export function readLevel(paths: LevelPaths, options: { tolerant?: boolean } = {}): LevelFiles {
  const problems: FieldError[] = [];
  const pick = (directory: string, names: string[], section: string): ConfigSource[] => {
    const byStem = new Map<string, string[]>();
    for (const name of names) {
      const key = stem(name);
      byStem.set(key, [...(byStem.get(key) ?? []), name]);
    }
    const sources: ConfigSource[] = [];
    for (const [key, group] of byStem) {
      const [first, second] = group;
      if (first !== undefined && second !== undefined) {
        problems.push({
          file: join(directory, first),
          path: section === '' ? 'swarm' : `swarm.${section}.${key}`,
          message: `defined by two files, ${join(directory, first)} and ${join(directory, second)}; keep one`,
        });
        continue;
      }
      if (first === undefined) continue;
      const path = join(directory, first);
      try {
        const read = readYaml(path);
        if (read.found) sources.push({ path, value: read.value, text: read.text });
      } catch (error) {
        if (!options.tolerant || !(error instanceof ConfigLoadError)) throw error;
        problems.push({
          file: path,
          path: section === '' ? 'swarm' : `swarm.${section}.${key}`,
          message: error.message,
        });
      }
    }
    return sources;
  };
  const settings = pick(paths.directory, listYaml(paths.directory, SETTINGS_NAME), '');
  const specialistsDirectory = join(paths.directory, SPECIALISTS_DIR);
  const workflowsDirectory = join(paths.directory, WORKFLOWS_DIR);
  const specialists = pick(specialistsDirectory, listYaml(specialistsDirectory), 'specialists');
  const workflows = pick(workflowsDirectory, listYaml(workflowsDirectory), 'workflows');
  const [first] = settings;
  return { ...(first ? { settings: first } : {}), specialists, workflows, problems };
}

/** *.yaml and *.yml files of a directory by code point; only `name` when given. */
function listYaml(directory: string, only?: string): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw new ConfigLoadError({ kind: 'read', path: directory, message: (error as Error).message });
  }
  return entries
    .filter((entry) => !entry.name.startsWith('.') && /\.ya?ml$/.test(entry.name))
    .filter((entry) => only === undefined || stem(entry.name) === only)
    .filter((entry) => {
      if (entry.isFile()) return true;
      if (!entry.isSymbolicLink()) return false;
      try {
        return statSync(join(directory, entry.name)).isFile();
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function readYaml(path: string): { found: boolean; value: unknown; text: string } {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { found: false, value: undefined, text: '' };
    throw new ConfigLoadError({ kind: 'read', path, message: (error as Error).message });
  }
  return { found: true, value: parseYaml(text, path), text };
}

/** Parses a YAML file; an empty file gives undefined, a syntax error a ConfigLoadError. */
export function parseYaml(text: string, path: string): unknown {
  const document = parseDocument(text, { merge: true, uniqueKeys: true });
  const [first] = document.errors;
  if (first) {
    throw new ConfigLoadError({ kind: 'syntax', path, message: first.message });
  }
  const value: unknown = document.toJS({ maxAliasCount: 100 });
  return value === null ? undefined : value;
}
