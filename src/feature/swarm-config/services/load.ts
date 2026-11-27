import { existsSync } from 'node:fs';
import { canonicalPipeline, parseYaml, readLevel } from '../repositories/config-files.ts';
import { assembleLevel, emptyLevel, loadGlobalSection, resolveLevels } from './assemble.ts';
import {
  validateConfig,
  validateNetworkSection,
  validateRuntimesSection,
  validateWebSection,
} from './validate.ts';
import { validateServerSection } from './sections/server.ts';
import { validateQueueSection } from './sections/queue.ts';
import { validateStatsSection } from './sections/stats.ts';
import { validateAttachmentsSection } from './sections/attachments.ts';
import { ConfigLoadError } from '../types/errors.ts';
import {
  ACTIONS_DIR,
  CHAINS_DIR,
  type ConfigPaths,
  type LevelFiles,
  type Level,
  type LevelPaths,
  type LoadedConfig,
  PIPELINES_DIR,
  PROVIDERS_DIR,
  SETTINGS_NAME,
  SPECIALISTS_DIR,
} from '../types/levels.ts';
import { type ConfigSource, isMapping } from '../types/merge.ts';
import {
  type AttachmentSettings,
  defaultAttachments,
  defaultNetwork,
  defaultRuntimes,
  defaultQueue,
  defaultServer,
  defaultStats,
  type NetworkSettings,
  type QueueSettings,
  type StatsSettings,
  defaultWeb,
  type ResolvedConfig,
  type RuntimeSettings,
  type ServerSettings,
  type WebSettings,
} from '../types/settings.ts';

/** Attachment storage for new uploads, reread from the shared settings.yaml on every call. */
export function loadAttachmentSettings(paths: ConfigPaths): AttachmentSettings {
  return loadGlobalSection(paths, 'attachments', defaultAttachments, (value) => {
    const { attachments, errors } = validateAttachmentsSection(value);
    return { value: attachments, errors };
  });
}

export function loadConfig(paths: ConfigPaths): ResolvedConfig {
  return loadConfigSources(paths).config;
}

export function levelIsEmpty(files: LevelFiles): boolean {
  return (
    files.settings === undefined &&
    files.specialists.length === 0 &&
    files.chains.length === 0 &&
    files.providers.length === 0 &&
    files.pipelines.length === 0 &&
    files.actions.length === 0 &&
    files.problems.length === 0
  );
}

/** Validate only the registry and its runtime routes, independently of chains being edited. */
function providerLevel(level: Level): Level {
  const swarm = isMapping(level.tree) && isMapping(level.tree.swarm) ? level.tree.swarm : {};
  const sections = ['roles', 'providers', 'default_provider', 'runtimes'];
  return {
    ...level,
    tree: {
      swarm: Object.fromEntries(Object.entries(swarm).filter(([key]) => sections.includes(key))),
    },
    problems: level.problems.filter(
      (problem) =>
        problem.path === 'swarm' ||
        sections.some(
          (section) =>
            problem.path === `swarm.${section}` || problem.path.startsWith(`swarm.${section}.`),
        ),
    ),
  };
}

export function loadConfigSources(paths: ConfigPaths, registryOnly = false): LoadedConfig {
  const global = readLevel(paths.global, { registryOnly });
  const project = readLevel(paths.project, { registryOnly });
  const levels: [LevelPaths, LevelFiles][] = [
    [paths.project, project],
    [paths.global, global],
  ];
  for (const [level, files] of levels) {
    // A filtered registry is allowed to be empty; it says nothing about other sections.
    if (registryOnly || !levelIsEmpty(files)) continue;
    const found = level.legacy.find((path) => existsSync(path));
    if (found !== undefined) {
      throw new ConfigLoadError({ kind: 'legacy', found, expected: level.directory });
    }
  }
  if (!registryOnly && levelIsEmpty(global) && levelIsEmpty(project)) {
    throw new ConfigLoadError({
      kind: 'no_files',
      expected: [paths.global.directory, paths.project.directory],
    });
  }
  const scope = registryOnly ? providerLevel : (level: Level) => level;
  const loaded = resolveLevels(scope(assembleLevel(global)), scope(assembleLevel(project)));
  return { ...loaded, legacy: [...(global.legacy ?? []), ...(project.legacy ?? [])] };
}

/** The shared level alone: the project files do not take part; throws `ConfigLoadError` without shared files. */
export function loadGlobalConfigSources(paths: ConfigPaths, registryOnly = false): LoadedConfig {
  const global = readLevel(paths.global, { registryOnly });
  if (!registryOnly && levelIsEmpty(global)) {
    throw new ConfigLoadError({ kind: 'no_files', expected: [paths.global.directory] });
  }
  const level = assembleLevel(global);
  const loaded = resolveLevels(registryOnly ? providerLevel(level) : level, emptyLevel());
  return { ...loaded, legacy: [...(global.legacy ?? [])] };
}

/** One project level without a global one, built from texts; keys are file names without extension. */
export function configFromFiles(files: {
  settings?: string;
  specialists?: Record<string, string>;
  chains?: Record<string, string>;
  providers?: Record<string, string>;
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
    providers: Object.entries(files.providers ?? {}).map(([name, text]) =>
      source(`${PROVIDERS_DIR}/${name}.yaml`, text),
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

/** Server mode settings from the global settings.yaml only; checked together with `web`. */
export function loadServerSettings(paths: ConfigPaths): ServerSettings {
  const web = loadWebSettings(paths);
  return loadGlobalSection(paths, 'server', defaultServer, (value) => {
    const { server, errors } = validateServerSection(value, web);
    return { value: server, errors };
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

/** The usage statistics settings from the global settings.yaml only. */
export function loadStatsSettings(paths: ConfigPaths): StatsSettings {
  return loadGlobalSection(paths, 'stats', defaultStats, (value) => {
    const { stats, errors } = validateStatsSection(value);
    return { value: stats, errors };
  });
}

/** The queue mode and the machine limit from the global settings.yaml only. */
export function loadQueueSettings(paths: ConfigPaths): QueueSettings {
  return loadGlobalSection(paths, 'queue', defaultQueue, (value) => {
    const { queue, errors } = validateQueueSection(value);
    return { value: queue, errors };
  });
}
