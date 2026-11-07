import { formatRoute } from '../../../shared/lib/nav/route.ts';
import type { SettingsGroup, SettingsScope } from '../../../shared/lib/nav/settingsGroups.ts';

/** Where the state and the restarts of the panel and the daemon are. */
export const SYSTEM_LINK = formatRoute({
  view: 'settings',
  run: 'system',
  group: 'global',
  step: null,
  tab: null,
});

export const hrefOf = (scope: SettingsScope, group: SettingsGroup) =>
  formatRoute({ view: 'settings', run: group, group: scope, step: null, tab: null });
