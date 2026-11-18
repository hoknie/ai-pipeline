import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { savedValue } from '../../../shared/ui/forms/settings/SettingField.tsx';
import { RUNTIME_KEYS } from '../../../shared/ui/forms/settings/settingFields.ts';

/** A runtime of the list: its state in the shared `settings.yaml`, with the defaults applied. */
export interface RuntimeRow {
  key: string;
  enabled: boolean;
  command: string;
  args: string[];
  /** How many variables the runtime has; their names and values are not part of the row. */
  envCount: number;
}

/** Every runtime that has fields in the config, in the order of their cards. */
export function runtimeRows(config: ConfigEditorResponse): RuntimeRow[] {
  const byPath = new Map(config.settings.map((setting) => [setting.path, setting]));
  const read = (key: string, field: string): unknown => {
    const setting = byPath.get(`runtimes.${key}.${field}`);
    return setting === undefined ? undefined : savedValue(setting, 'global');
  };
  return RUNTIME_KEYS.filter((key) =>
    ['enabled', 'command', 'args', 'env'].some((field) => byPath.has(`runtimes.${key}.${field}`)),
  ).map((key) => {
    const command = read(key, 'command');
    const args = read(key, 'args');
    const env = read(key, 'env');
    return {
      key,
      enabled: read(key, 'enabled') === true,
      command: typeof command === 'string' ? command : '',
      args: Array.isArray(args) ? args.map(String) : [],
      envCount: Array.isArray(env) ? env.length : 0,
    };
  });
}

/** Whether a row matches the words typed in the search: by title and key. */
export function matchesRuntime(row: RuntimeRow, title: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${title} ${row.key}`.toLowerCase();
  return words.every((word) => text.includes(word));
}
