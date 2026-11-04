import { settingsLocationOf } from './settingsGroups.ts';

export type View = 'runs' | 'topology' | 'queue' | 'specialists' | 'workflows' | 'settings';

export interface Route {
  view: View;
  /**
   * Run on the runs tab, workflow on the topology tab, specialist (or `new`) on the specialists
   * tab, group of settings on the settings tab.
   */
  run: string | null;
  /** On the runs tab the group of a run; on the settings tab the tab of the page (`global`, `project`). */
  group: string | null;
  /** Step whose last attempt is opened in the group. */
  step: string | null;
}

/** The settings route of `#settings/<tab>/<group>`, or of an old `#settings/<group>`. */
function settingsRoute(first: string | null, second: string | null): Route {
  const { scope, group } = settingsLocationOf(first, second);
  return { view: 'settings', run: group, group: scope, step: null };
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
    if (decode(rest[0]) === '_settings') return settingsRoute(null, null);
    return { view: 'specialists', run: decode(rest[0]), group: null, step: null };
  }
  if (head === 'settings') return settingsRoute(decode(rest[0]), decode(rest[1]));
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
  if (route.view === 'settings') {
    const place = settingsLocationOf(route.group, route.run);
    // an old route with the group only (`run`) leads to its new place
    const { scope, group } = route.group === null ? settingsLocationOf(route.run, null) : place;
    return `#settings/${scope}/${group}`;
  }
  if (route.view === 'workflows') return route.run ? `#workflows/${enc(route.run)}` : '#workflows';
  if (!route.run) return '#runs';
  const parts = [route.run, route.group, route.group ? route.step : null].filter(
    (part): part is string => part !== null,
  );
  return `#runs/${parts.map(enc).join('/')}`;
}
