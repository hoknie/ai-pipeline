import {
  CLAUDE_EDIT_MODES,
  CLAUDE_MCP_MODES,
  CLAUDE_SETTINGS_SOURCES,
  DELIVERY_MODES,
  MAX_RANGE,
  MAX_ROUNDS_RANGE,
  OUTSIDE_CHANGES,
  PERMISSIONS,
  RUNTIMES,
  WEB_AUTH_MODES,
  WEB_HOSTS,
  WORKSPACE_BASES,
} from '../../swarm-config/types/index.ts';
import { type SettingField, type SettingKind } from './editor.ts';

const WEB_PORT_RANGE = [1, 65535] as const;

const RESOLVER_ROUNDS_RANGE = MAX_ROUNDS_RANGE;

const NETWORK_INTERVAL_RANGE = [5, 3600] as const;

const NETWORK_TIMEOUT_RANGE = [1, 60] as const;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function field(
  path: string,
  kind: SettingKind,
  extra: {
    options?: readonly string[];
    range?: readonly [number, number];
    globalOnly?: boolean;
  } = {},
): SettingField {
  return { path, kind, ...extra, globalOnly: extra.globalOnly ?? false };
}

/** Every field of settings.yaml the editor writes, in the order the editor shows them. */
export const SETTING_FIELDS: readonly SettingField[] = [
  field('max', 'integer', { range: MAX_RANGE }),
  field('workspace_dir', 'string'),
  field('outside_changes', 'choice', { options: OUTSIDE_CHANGES }),
  field('defaults.runtime', 'choice', { options: RUNTIMES }),
  field('defaults.permissions', 'choice', { options: PERMISSIONS }),
  field('defaults.timeout', 'duration'),
  field('defaults.allow_commands', 'strings'),
  field('defaults.tools', 'strings'),
  field('claude.edit_mode', 'choice', { options: CLAUDE_EDIT_MODES }),
  field('claude.mcp', 'choice', { options: CLAUDE_MCP_MODES }),
  field('claude.settings', 'choice', { options: CLAUDE_SETTINGS_SOURCES }),
  field('delivery.mode', 'choice', { options: DELIVERY_MODES }),
  field('delivery.auto', 'boolean'),
  field('delivery.keep', 'boolean'),
  field('delivery.commit_message', 'string'),
  field('delivery.message_specialist', 'specialist'),
  field('delivery.resolver', 'specialist'),
  field('delivery.resolver_rounds', 'integer', { range: RESOLVER_ROUNDS_RANGE }),
  field('delivery.message_prompt', 'string'),
  field('delivery.resolver_prompt', 'string'),
  field('workspace.base', 'choice', { options: WORKSPACE_BASES }),
  field('workspace.include', 'strings'),
  field('naming.enabled', 'boolean'),
  field('naming.runtime', 'choice', { options: RUNTIMES }),
  field('naming.model', 'string'),
  field('web.autostart', 'boolean', { globalOnly: true }),
  field('web.auth', 'choice', { options: WEB_AUTH_MODES, globalOnly: true }),
  field('web.host', 'choice', { options: WEB_HOSTS, globalOnly: true }),
  field('web.port', 'integer', { range: WEB_PORT_RANGE, globalOnly: true }),
  field('network.enabled', 'boolean', { globalOnly: true }),
  field('network.targets', 'strings', { globalOnly: true }),
  field('network.interfaces', 'strings', { globalOnly: true }),
  field('network.proxy', 'string', { globalOnly: true }),
  field('network.interval', 'integer', { range: NETWORK_INTERVAL_RANGE, globalOnly: true }),
  field('network.timeout', 'integer', { range: NETWORK_TIMEOUT_RANGE, globalOnly: true }),
  field('stats.enabled', 'boolean', { globalOnly: true }),
  field('stats.exclude', 'strings', { globalOnly: true }),
  field('stats.show_cost', 'boolean', { globalOnly: true }),
  ...RUNTIMES.flatMap((runtime) => [
    field(`runtimes.${runtime}.enabled`, 'boolean', { globalOnly: true }),
    field(`runtimes.${runtime}.command`, 'string', { globalOnly: true }),
    field(`runtimes.${runtime}.args`, 'strings', { globalOnly: true }),
    field(`runtimes.${runtime}.env`, 'env', { globalOnly: true }),
  ]),
];

const ENV_VARIABLE_PATH = /^runtimes\.([a-z]+)\.env\.(.+)$/;

/** The field for a path, also a single variable `runtimes.<runtime>.env.<NAME>`; undefined for any other path. */
export function settingFieldOf(path: string): SettingField | undefined {
  const known = SETTING_FIELDS.find((candidate) => candidate.path === path);
  if (known) return known;
  const match = ENV_VARIABLE_PATH.exec(path);
  if (
    match &&
    (RUNTIMES as readonly string[]).includes(match[1] as string) &&
    ENV_NAME.test(match[2] as string)
  ) {
    return field(path, 'env', { globalOnly: true });
  }
  return undefined;
}

/** A variable of `runtimes.<runtime>.env` (a string), as opposed to the whole `env` section. */
export function isEnvVariable(path: string): boolean {
  return ENV_VARIABLE_PATH.test(path);
}
