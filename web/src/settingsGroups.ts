import type { FieldError } from './types.ts';

/** The two tabs of the settings page: the shared `settings.yaml` and the one of the project. */
export const SETTINGS_SCOPES = ['global', 'project'] as const;
export type SettingsScope = (typeof SETTINGS_SCOPES)[number];

/** Groups of the settings page, per tab, in the order of the column on the left. */
export const SETTINGS_GROUPS_BY_SCOPE = {
  global: [
    'general',
    'agents',
    'delivery',
    'runtimes',
    'specialists',
    'pipelines',
    'observers',
    'system',
  ],
  project: ['general', 'agents', 'delivery', 'queue', 'tags'],
} as const;

export type SettingsGroup =
  | (typeof SETTINGS_GROUPS_BY_SCOPE)['global'][number]
  | (typeof SETTINGS_GROUPS_BY_SCOPE)['project'][number];

export const DEFAULT_SETTINGS_SCOPE: SettingsScope = 'global';
export const DEFAULT_SETTINGS_GROUP: SettingsGroup = 'general';

/** Where the group keys of earlier versions (`#settings/<group>`) lead now. */
export const LEGACY_SETTINGS_GROUPS: Record<
  string,
  { scope: SettingsScope; group: SettingsGroup }
> = {
  general: { scope: 'global', group: 'general' },
  defaults: { scope: 'global', group: 'agents' },
  delivery: { scope: 'global', group: 'delivery' },
  workspace: { scope: 'global', group: 'general' },
  naming: { scope: 'global', group: 'general' },
  claude: { scope: 'global', group: 'agents' },
  runtimes: { scope: 'global', group: 'runtimes' },
  web: { scope: 'global', group: 'system' },
  queue: { scope: 'project', group: 'queue' },
  tags: { scope: 'project', group: 'tags' },
  system: { scope: 'global', group: 'system' },
};

/** The tabs of the group «Observers»; the third part of its address. */
export const OBSERVER_TABS = ['general', 'specialist', 'projects'] as const;
export type ObserverTab = (typeof OBSERVER_TABS)[number];

/** The tab of the group «Observers» for the part of an address; an unknown one is the first. */
export function observerTabOf(part: string | null): ObserverTab {
  return OBSERVER_TABS.find((tab) => tab === part) ?? 'general';
}

const isScope = (key: string | null): key is SettingsScope =>
  SETTINGS_SCOPES.some((scope) => scope === key);

/**
 * The tab and the group of the two address parts. A group the tab does not have opens its first
 * group; a single old group key (`scope` holds it) leads to its new place.
 */
export function settingsLocationOf(
  scope: string | null,
  group: string | null,
): { scope: SettingsScope; group: SettingsGroup } {
  // the catalog of tags left the shared tab: its address leads to the project tab
  if (scope === 'global' && group === 'tags') return { scope: 'project', group: 'tags' };
  if (isScope(scope)) {
    const groups: readonly string[] = SETTINGS_GROUPS_BY_SCOPE[scope];
    const found = groups.find((candidate) => candidate === group);
    return { scope, group: (found as SettingsGroup | undefined) ?? DEFAULT_SETTINGS_GROUP };
  }
  const legacy = scope === null ? undefined : LEGACY_SETTINGS_GROUPS[scope];
  if (legacy === undefined && scope === 'agents') return { scope: 'global', group: 'agents' };
  return legacy ?? { scope: DEFAULT_SETTINGS_SCOPE, group: DEFAULT_SETTINGS_GROUP };
}

/** The group of a settings field: `swarm.web.port` and `web.port` are «system». */
export function groupOf(path: string): SettingsGroup {
  const section = path.replace(/^swarm\./, '').split('.')[0] ?? '';
  if (section === 'defaults' || section === 'claude') return 'agents';
  if (section === 'delivery') return 'delivery';
  if (section === 'runtimes') return 'runtimes';
  if (section === 'web') return 'system';
  return DEFAULT_SETTINGS_GROUP;
}

/**
 * The group a validation error belongs to: `swarm.naming.runtime` is «general»; errors of
 * specialists and pipelines, which have no group of their own, are shown in «general» too.
 */
export function errorGroupOf(path: string): SettingsGroup {
  return groupOf(path);
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
