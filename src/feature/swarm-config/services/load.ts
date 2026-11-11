import { existsSync } from 'node:fs';
import { canonicalPipeline, parseYaml, readLevel } from '../repositories/config-files.ts';
import { assembleLevel, emptyLevel, loadGlobalSection, resolveLevels } from './assemble.ts';
import {
  validateConfig,
  validateNetworkSection,
  validateRuntimesSection,
  validateWebSection,
} from './validate.ts';
import { ConfigLoadError } from '../types/errors.ts';
import {
  ACTIONS_DIR,
  CHAINS_DIR,
  type ConfigPaths,
  type LevelFiles,
  type LevelPaths,
  type LoadedConfig,
  PIPELINES_DIR,
  SETTINGS_NAME,
  SPECIALISTS_DIR,
} from '../types/levels.ts';
import { type ConfigSource } from '../types/merge.ts';
import {
  defaultNetwork,
  defaultRuntimes,
  type NetworkSettings,
  defaultWeb,
  type ResolvedConfig,
  type RuntimeSettings,
  type WebSettings,
} from '../types/settings.ts';

export function loadConfig(paths: ConfigPaths): ResolvedConfig {
  return loadConfigSources(paths).config;
}

export function levelIsEmpty(files: LevelFiles): boolean {
  return (
    files.settings === undefined &&
    files.specialists.length === 0 &&
    files.chains.length === 0 &&
    files.pipelines.length === 0 &&
    files.actions.length === 0 &&
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
  const loaded = resolveLevels(assembleLevel(global), assembleLevel(project));
  return { ...loaded, legacy: [...(global.legacy ?? []), ...(project.legacy ?? [])] };
}

/** One project level without a global one, built from texts; keys are file names without extension. */
export function configFromFiles(files: {
  settings?: string;
  specialists?: Record<string, string>;
  chains?: Record<string, string>;
  pipelines?: Record<string, string>;
  actions?: Record<string, string>;
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
    chains: Object.entries(files.chains ?? {}).map(([name, text]) =>
      source(`${CHAINS_DIR}/${name}.yaml`, text),
    ),
    pipelines: Object.entries(files.pipelines ?? {}).map(([name, text]) => {
      const read = source(`${PIPELINES_DIR}/${name}.yaml`, text);
      return { ...read, value: canonicalPipeline(read.value) };
    }),
    actions: Object.entries(files.actions ?? {}).map(([name, text]) =>
      source(`${ACTIONS_DIR}/${name}.yaml`, text),
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

/** The network check from the global settings.yaml only. */
export function loadNetworkSettings(paths: ConfigPaths): NetworkSettings {
  return loadGlobalSection(paths, 'network', defaultNetwork, (value) => {
    const { network, errors } = validateNetworkSection(value);
    return { value: network, errors };
  });
}
