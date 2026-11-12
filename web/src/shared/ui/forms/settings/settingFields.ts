import type { EditorSetting } from '../../../api/types.ts';
import type { SettingsGroup } from '../../../lib/nav/settingsGroups.ts';
import type { SpecialistOption } from './specialistLabels.ts';

/** Radix `Select` has no empty value: this one stands for «not set». */
export const NONE = '__none';

/** The items of a choice: the value is written to the file, the label is shown. */
export function choiceItems(
  setting: EditorSetting,
  specialists: SpecialistOption[],
  t: (key: string) => string,
): { value: string; label: string }[] {
  if (setting.kind === 'specialist') {
    return [
      { value: NONE, label: t('settingsPage.notSet') },
      ...specialists.map((specialist) => ({ value: specialist.slug, label: specialist.label })),
    ];
  }
  return (setting.options ?? []).map((option) => ({
    value: option,
    label: setting.path === 'delivery.mode' ? t(`deliveryMode.${option}`) : option,
  }));
}

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
    {
      key: 'message',
      paths: ['delivery.commit_message', 'delivery.message_specialist', 'delivery.message_prompt'],
    },
    {
      key: 'conflicts',
      paths: ['delivery.resolver', 'delivery.resolver_rounds', 'delivery.resolver_prompt'],
    },
  ],
  runtimes: [
    {
      key: 'claude',
      paths: [
        'runtimes.claude.enabled',
        'runtimes.claude.command',
        'runtimes.claude.args',
        'runtimes.claude.env',
      ],
    },
    {
      key: 'opencode',
      paths: [
        'runtimes.opencode.enabled',
        'runtimes.opencode.command',
        'runtimes.opencode.args',
        'runtimes.opencode.env',
      ],
    },
    {
      key: 'agy',
      paths: [
        'runtimes.agy.enabled',
        'runtimes.agy.command',
        'runtimes.agy.args',
        'runtimes.agy.env',
      ],
    },
  ],
  system: [
    { key: 'panel', paths: ['web.autostart', 'web.auth', 'web.host', 'web.port'] },
    {
      key: 'network',
      paths: [
        'network.enabled',
        'network.targets',
        'network.interfaces',
        'network.proxy',
        'network.interval',
        'network.timeout',
      ],
    },
    { key: 'stats', paths: ['stats.enabled', 'stats.show_cost', 'stats.exclude'] },
  ],
};

/** The cards of the settings of a built-in stage; the group of the titles is `delivery`. */
export const STAGE_SECTIONS: Record<'message' | 'resolve' | 'delivery', SettingsSection[]> = {
  message: [
    {
      key: 'message',
      paths: ['delivery.message_specialist', 'delivery.commit_message', 'delivery.message_prompt'],
    },
  ],
  resolve: [
    {
      key: 'conflicts',
      paths: ['delivery.resolver', 'delivery.resolver_rounds', 'delivery.resolver_prompt'],
    },
  ],
  delivery: [{ key: 'delivery', paths: ['delivery.mode', 'delivery.auto', 'delivery.keep'] }],
};

/** Fields shown as a text area: a long text, not a one-line value. */
export const MULTILINE_FIELDS: ReadonlySet<string> = new Set([
  'delivery.commit_message',
  'delivery.message_prompt',
  'delivery.resolver_prompt',
]);

/** The locale key of a field: dots become underscores, the runtime name is not part of it. */
export function fieldKey(path: string): string {
  return path.replace(/^runtimes\.[a-z]+\./, 'runtimes.').replaceAll('.', '_');
}

/** The pattern of the name of an environment variable. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The path of one environment variable of a runtime. */
export const envPath = (envField: string, name: string): string => `${envField}.${name}`;
