import { key } from '../types/editor.ts';
import {
  loadNetworkSettings,
  loadRuntimeSettings,
  loadWebSettings,
  mergeOrigins,
  validateConfig,
} from '../../swarm-config/services/index.ts';
import {
  ConfigLoadError,
  type ConfigPaths,
  type ConfigSource,
  defaultNetwork,
  defaultRuntimes,
  defaultWeb,
  formatDuration,
  isMapping,
  type Level,
  type LevelFiles,
  type NetworkSettings,
  redactProxy,
  type ResolvedConfig,
  RUNTIMES,
  type RuntimeSettings,
  type WebSettings,
} from '../../swarm-config/types/index.ts';
import { emptyLevel, resolution } from './levels.ts';
import { type EditorSetting, type SettingField, type SettingKind } from '../types/editor.ts';
import { settingFieldOf } from '../types/setting-fields.ts';

export type Files = { global: LevelFiles; project: LevelFiles };

function settingsOf(config: ResolvedConfig): [string, unknown][] {
  return [
    ['max', config.max],
    ['workspace_dir', config.workspaceDir],
    ['outside_changes', config.outsideChanges],
    ['defaults.runtime', config.defaults.runtime],
    ['defaults.permissions', config.defaults.permissions],
    ['defaults.timeout', formatDuration(config.defaults.timeoutSeconds)],
    ['defaults.allow_commands', config.defaults.allowCommands],
    ['defaults.tools', config.defaults.tools],
    ['claude.edit_mode', config.claude.editMode],
    ['claude.mcp', config.claude.mcp],
    ['claude.settings', config.claude.settings],
    ['delivery.mode', config.delivery.mode],
    ['delivery.auto', config.delivery.auto],
    ['delivery.keep', config.delivery.keep],
    ['delivery.commit_message', config.delivery.commitMessage],
    ['delivery.message_specialist', config.delivery.messageSpecialist],
    ['delivery.resolver', config.delivery.resolver],
    ['delivery.resolver_rounds', config.delivery.resolverRounds],
    ['delivery.message_prompt', config.delivery.messagePrompt ?? null],
    ['delivery.resolver_prompt', config.delivery.resolverPrompt ?? null],
    ['workspace.base', config.workspace.base],
    ['workspace.include', config.workspace.include],
    ['naming.enabled', config.naming.enabled],
    ['naming.runtime', config.naming.runtime],
    ['naming.model', config.naming.model],
  ];
}

/**
 * `web.*`, `network.*` and `runtimes.*` as the daemon reads them: from the global settings.yaml only. The value
 * of `env` never leaves the config layer: only the sorted names of the variables do.
 */
function globalSectionSettings(
  paths: ConfigPaths,
  global: LevelFiles,
): { path: string; value: unknown; file: string | null }[] {
  const file = global.settings?.path ?? null;
  const root = isMapping(global.settings?.value) ? global.settings.value : {};
  const has = (section: string, ...keys: string[]): boolean => {
    let node: unknown = root[section];
    for (const key of keys) {
      if (!isMapping(node) || !(key in node)) return false;
      node = node[key];
    }
    return true;
  };
  const originOf = (section: string, ...keys: string[]) => (has(section, ...keys) ? file : null);
  const safe = <T>(read: () => T, fallback: () => T): T => {
    try {
      return read();
    } catch (error) {
      if (error instanceof ConfigLoadError) return fallback();
      throw error;
    }
  };
  const web = safe(() => loadWebSettings(paths), defaultWeb);
  const runtimes = safe(() => loadRuntimeSettings(paths), defaultRuntimes);
  const network = safe(() => loadNetworkSettings(paths), defaultNetwork);
  return sectionValues(web, runtimes, network).map(([path, value]) => ({
    path,
    value,
    file: originOf(...(path.split('.') as [string, ...string[]])),
  }));
}

/** `web.*` and `runtimes.*` values as pairs; the value of `env` is reduced to the sorted names. */
function sectionValues(
  web: WebSettings,
  runtimes: RuntimeSettings,
  network: NetworkSettings,
): [string, unknown][] {
  const result: [string, unknown][] = [
    ['web.autostart', web.autostart],
    ['web.auth', web.auth],
    ['web.host', web.host],
    ['web.port', web.port],
    ['network.enabled', network.enabled],
    ['network.targets', network.targets],
    ['network.interfaces', network.interfaces],
    ['network.proxy', network.proxy === null ? null : redactProxy(network.proxy)],
    ['network.interval', network.interval],
    ['network.timeout', network.timeout],
  ];
  for (const runtime of RUNTIMES) {
    const command = runtimes[runtime];
    result.push(
      [`runtimes.${runtime}.command`, command.command],
      [`runtimes.${runtime}.args`, command.args],
      [`runtimes.${runtime}.env`, Object.keys(command.env).sort()],
    );
  }
  return result;
}

/** Settings that are not valid are shown with the defaults, the errors say what is wrong. */
function configOrDefaults(config: ResolvedConfig | null): ResolvedConfig {
  if (config) return config;
  const result = validateConfig({ swarm: {} });
  if (!result.ok) throw new Error('the empty configuration must be valid');
  return result.config;
}

function writtenOf(source: ConfigSource | undefined, path: string, kind: SettingKind) {
  let node: unknown = source?.value;
  for (const part of path.split('.')) {
    if (!isMapping(node) || !(part in node)) return undefined;
    node = node[part];
  }
  if (path === 'network.proxy' && typeof node === 'string') return redactProxy(node);
  return kind === 'env' && isMapping(node) ? Object.keys(node).sort() : node;
}

function globalNetwork(paths: ConfigPaths): NetworkSettings {
  try {
    return loadNetworkSettings(paths);
  } catch (error) {
    if (error instanceof ConfigLoadError) return defaultNetwork();
    throw error;
  }
}

/** Whether the proxy URL carries a login or a password. */
function hasCredentials(network: NetworkSettings): boolean {
  return network.proxy !== null && redactProxy(network.proxy) !== network.proxy.replace(/\/$/, '');
}

export function editorSettings(
  paths: ConfigPaths,
  files: Files,
  global: Level,
  project: Level,
): EditorSetting[] {
  const { config } = resolution(global, project);
  const origins = mergeOrigins(global, project);
  const base = [
    ...settingsOf(configOrDefaults(config)).map(([path, value]) => ({
      path,
      value,
      file: origins.get(`swarm.${path}`) ?? null,
    })),
    ...globalSectionSettings(paths, files.global),
  ];
  const defaultValues = new Map<string, unknown>([
    ...settingsOf(configOrDefaults(null)),
    ...sectionValues(defaultWeb(), defaultRuntimes(), defaultNetwork()),
  ]);
  const proxyCredentials = hasCredentials(globalNetwork(paths));
  const aloneConfig = resolution(global, emptyLevel()).config;
  const globalValues = new Map<string, unknown>(settingsOf(configOrDefaults(aloneConfig)));
  return base.map((entry) => {
    const setting = settingFieldOf(entry.path) as SettingField;
    const written: EditorSetting['written'] = {};
    const inGlobal = writtenOf(files.global.settings, entry.path, setting.kind);
    const inProject = setting.globalOnly
      ? undefined
      : writtenOf(files.project.settings, entry.path, setting.kind);
    if (inGlobal !== undefined) written.global = inGlobal;
    if (inProject !== undefined) written.project = inProject;
    return {
      ...entry,
      kind: setting.kind,
      ...(setting.options ? { options: setting.options } : {}),
      ...(setting.range ? { range: setting.range } : {}),
      globalOnly: setting.globalOnly,
      defaultValue: defaultValues.get(entry.path),
      globalValue: setting.globalOnly ? entry.value : globalValues.get(entry.path),
      written,
      ...(entry.path === 'network.proxy' && proxyCredentials ? { credentials: true } : {}),
    };
  });
}
