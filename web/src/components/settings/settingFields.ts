import type { SettingsGroup } from '../../settingsGroups.ts';

/** A card of a group: its key names the title, `paths` are the fields in the order shown. */
export interface SettingsSection {
  key: string;
  paths: string[];
}

/** The forms of the groups; «queue», «tags» and the state of «system» are not forms of fields. */
export const SETTINGS_SECTIONS: Partial<Record<SettingsGroup, SettingsSection[]>> = {
  general: [
    { key: 'runs', paths: ['max', 'outside_changes'] },
    { key: 'workspace', paths: ['workspace_dir', 'workspace.base', 'workspace.include'] },
    { key: 'naming', paths: ['naming.enabled', 'naming.runtime', 'naming.model'] },
  ],
  agents: [
    {
      key: 'defaults',
      paths: [
        'defaults.runtime',
        'defaults.permissions',
        'defaults.timeout',
        'defaults.allow_commands',
        'defaults.tools',
      ],
    },
    { key: 'claude', paths: ['claude.edit_mode', 'claude.mcp', 'claude.settings'] },
  ],
  delivery: [
    { key: 'delivery', paths: ['delivery.mode', 'delivery.auto', 'delivery.keep'] },
    { key: 'message', paths: ['delivery.commit_message', 'delivery.message_specialist'] },
    { key: 'conflicts', paths: ['delivery.resolver', 'delivery.resolver_rounds'] },
  ],
  runtimes: [
    {
      key: 'claude',
      paths: ['runtimes.claude.command', 'runtimes.claude.args', 'runtimes.claude.env'],
    },
    {
      key: 'opencode',
      paths: ['runtimes.opencode.command', 'runtimes.opencode.args', 'runtimes.opencode.env'],
    },
  ],
  system: [{ key: 'panel', paths: ['web.autostart', 'web.auth', 'web.host', 'web.port'] }],
};

/** The locale key of a field: dots become underscores, the runtime name is not part of it. */
export function fieldKey(path: string): string {
  return path.replace(/^runtimes\.[a-z]+\./, 'runtimes.').replaceAll('.', '_');
}

/** The pattern of the name of an environment variable. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The path of one environment variable of a runtime. */
export const envPath = (envField: string, name: string): string => `${envField}.${name}`;
