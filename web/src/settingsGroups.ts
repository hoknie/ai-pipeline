import type { FieldError } from './types.ts';

/** Groups of the settings page, in the order of the column on the left. */
export const SETTINGS_GROUPS = [
  'general',
  'defaults',
  'delivery',
  'workspace',
  'naming',
  'claude',
  'runtimes',
  'web',
  'queue',
  'tags',
  'system',
] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export const DEFAULT_SETTINGS_GROUP: SettingsGroup = 'general';

/** The group of an address part; an unknown or missing one opens the first group. */
export function settingsGroupOf(key: string | null): SettingsGroup {
  return SETTINGS_GROUPS.find((group) => group === key) ?? DEFAULT_SETTINGS_GROUP;
}

/** Groups whose fields are the sections of `settings.yaml` of the same name. */
const SECTION_GROUPS = new Set<string>([
  'defaults',
  'delivery',
  'workspace',
  'naming',
  'claude',
  'runtimes',
  'web',
]);

/** The group of a settings field: its section, or «general» for the fields of the top level. */
export function groupOf(path: string): SettingsGroup {
  const section = path.split('.')[0] ?? '';
  return SECTION_GROUPS.has(section) ? (section as SettingsGroup) : DEFAULT_SETTINGS_GROUP;
}

/**
 * The group a validation error belongs to: `swarm.naming.runtime` is «naming»; errors of
 * specialists and workflows, which have no group of their own, are shown in «general».
 */
export function errorGroupOf(path: string): SettingsGroup {
  return groupOf(path.replace(/^swarm\./, ''));
}

/** Errors per group; groups without errors are absent. */
export function errorsByGroup(errors: FieldError[]): Map<SettingsGroup, FieldError[]> {
  const result = new Map<SettingsGroup, FieldError[]>();
  for (const error of errors) {
    const group = errorGroupOf(error.path);
    result.set(group, [...(result.get(group) ?? []), error]);
  }
  return result;
}
