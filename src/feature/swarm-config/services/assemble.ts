import { stem } from '../types/levels.ts';
import { join } from 'node:path';
import { listYaml, readYaml } from '../repositories/config-files.ts';
import { validateConfig } from './validate.ts';
import { ConfigLoadError, type FieldError } from '../types/errors.ts';
import {
  type ConfigPaths,
  type Level,
  type LevelFiles,
  type LoadedConfig,
  SETTINGS_NAME,
} from '../types/levels.ts';
import { type ConfigSource, isMapping, KEYED_SECTIONS, mergeConfigs } from '../types/merge.ts';
import { type ResolvedConfig } from '../types/settings.ts';

export function emptyLevel(): Level {
  return { tree: undefined, origins: new Map(), files: [], problems: [] };
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
        if (key === 'specialists' || key === 'chains' || key === 'pipelines' || key === 'actions') {
          problems.push({
            file: settingsFile,
            path: `swarm.${key}`,
            message: `${key} are files of the ${key}/ directory, not a key of settings`,
          });
          continue;
        }
        if (key === 'workflows') {
          problems.push({
            file: settingsFile,
            path: `swarm.${key}`,
            message: `${key} are files of the pipelines/ directory, not a key of settings`,
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
  const entries = (section: string, sources: ConfigSource[] | undefined): void => {
    if (!sources || sources.length === 0) return;
    const map: Record<string, unknown> = {};
    for (const source of sources) {
      const name = stem(source.path);
      map[name] = source.value === undefined ? null : source.value;
      origins.set(`swarm.${section}.${name}`, source.path);
    }
    swarm[section] = map;
  };
  entries('specialists', files.specialists);
  entries('chains', files.chains);
  entries('pipelines', files.pipelines);
  entries('actions', files.actions);
  const present =
    files.settings !== undefined ||
    files.specialists.length +
      (files.chains?.length ?? 0) +
      files.pipelines.length +
      files.actions.length >
      0;
  return {
    tree: present ? { swarm } : undefined,
    origins,
    files: [
      ...(settingsFile === undefined ? [] : [settingsFile]),
      ...files.specialists.map((source) => source.path),
      ...files.chains.map((source) => source.path),
      ...files.pipelines.map((source) => source.path),
      ...files.actions.map((source) => source.path),
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
  const projectChains = isMapping(projectSwarm) ? projectSwarm.chains : undefined;
  const projectActions = isMapping(projectSwarm) ? projectSwarm.actions : undefined;
  const config: ResolvedConfig = {
    ...result.config,
    specialists: result.config.specialists.map((specialist) =>
      isMapping(projectSpecialists) && specialist.slug in projectSpecialists
        ? specialist
        : { ...specialist, level: 'global' },
    ),
    chains: (result.config.chains ?? []).map((chain) =>
      isMapping(projectChains) && chain.slug in projectChains
        ? chain
        : { ...chain, level: 'global' },
    ),
    actions: result.config.actions.map((action) =>
      isMapping(projectActions) && action.id in projectActions
        ? action
        : { ...action, level: 'global' },
    ),
  };
  return { config, files: [...global.files, ...project.files] };
}

/**
 * One section of the global settings.yaml, validated alone; errors in other fields and files do
 * not matter. Without the file or the section the defaults apply.
 */
export function loadGlobalSection<T>(
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
