import { DEFAULT_SETTINGS_GROUP, settingsGroupOf } from './settingsGroups.ts';

export type View = 'runs' | 'topology' | 'queue' | 'specialists' | 'workflows' | 'settings';

export interface Route {
  view: View;
  /**
   * Run on the runs tab, workflow on the topology tab, specialist (or `new`) on the specialists
   * tab, group of settings on the settings tab.
   */
  run: string | null;
  group: string | null;
  /** Step whose last attempt is opened in the group. */
  step: string | null;
}

const decode = (part: string | undefined) => (part ? decodeURIComponent(part) : null);

/** `#runs/<run>/<group>/<step>`, `#topology/<run>`; the older `#<run>/<group>` still works. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  const [head, ...rest] = parts;
  if (head === 'queue') return { view: 'queue', run: null, group: null, step: null };
  if (head === 'topology')
    return { view: 'topology', run: decode(rest[0]), group: null, step: null };
  if (head === 'workflows')
    return { view: 'workflows', run: decode(rest[0]), group: null, step: null };
  if (head === 'specialists') {
    // the former «General settings» entry of the specialists list
    if (decode(rest[0]) === '_settings')
      return { view: 'settings', run: DEFAULT_SETTINGS_GROUP, group: null, step: null };
    return { view: 'specialists', run: decode(rest[0]), group: null, step: null };
  }
  if (head === 'settings')
    return { view: 'settings', run: settingsGroupOf(decode(rest[0])), group: null, step: null };
  if (head === 'runs') {
    return { view: 'runs', run: decode(rest[0]), group: decode(rest[1]), step: decode(rest[2]) };
  }
  return { view: 'runs', run: decode(head), group: decode(rest[0]), step: null };
}

export function formatRoute(route: Route): string {
  const enc = encodeURIComponent;
  if (route.view === 'queue') return '#queue';
  if (route.view === 'topology') return route.run ? `#topology/${enc(route.run)}` : '#topology';
  if (route.view === 'specialists')
    return route.run ? `#specialists/${enc(route.run)}` : '#specialists';
  if (route.view === 'settings') return `#settings/${enc(settingsGroupOf(route.run))}`;
  if (route.view === 'workflows') return route.run ? `#workflows/${enc(route.run)}` : '#workflows';
  if (!route.run) return '#runs';
  const parts = [route.run, route.group, route.group ? route.step : null].filter(
    (part): part is string => part !== null,
  );
  return `#runs/${parts.map(enc).join('/')}`;
}
