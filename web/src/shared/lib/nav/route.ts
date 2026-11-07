import { observerTabOf, settingsLocationOf } from './settingsGroups.ts';

export type View = 'runs' | 'topology' | 'queue' | 'specialists' | 'pipelines' | 'settings';

export interface Route {
  view: View;
  /**
   * Run on the runs tab, pipeline on the topology tab, specialist (or `new`) on the specialists
   * tab, group of settings on the settings tab; on the pipeline tab the id of a pipeline, of an
   * action or of a system stage.
   */
  run: string | null;
  /**
   * On the runs tab the group of a run; on the settings tab the tab of the page (`global`,
   * `project`); on the pipeline tab the section (`actions`, `system`), null for the pipelines.
   */
  group: string | null;
  /**
   * Step whose last attempt is opened in the group; on the pipeline tab, for a system stage,
   * `global` is the level tab of the stage.
   */
  step: string | null;
  /** Tab of the group screen; null for the default log tab. */
  tab: string | null;
}

/** The settings route of `#settings/<tab>/<group>`, or of an old `#settings/<group>`. */
function settingsRoute(first: string | null, second: string | null, third: string | null): Route {
  const { scope, group } = settingsLocationOf(first, second);
  // a shared specialist (or `new`) of the group «Specialists» is the third part; for the
  // observers it is the tab of the group
  const step =
    scope === 'global' && (group === 'specialists' || group === 'pipelines')
      ? third
      : scope === 'global' && group === 'observers' && third !== null
        ? observerTabOf(third)
        : null;
  return { view: 'settings', run: group, group: scope, step, tab: null };
}

/** Sections of the pipeline list other than the pipelines. */
export const PIPELINE_SECTIONS = ['actions', 'system'] as const;
export type PipelineSection = (typeof PIPELINE_SECTIONS)[number];

export const isPipelineSection = (value: string | null): value is PipelineSection =>
  PIPELINE_SECTIONS.some((section) => section === value);

const decode = (part: string | undefined) => (part ? decodeURIComponent(part) : null);

/** `#runs/<run>/<group>/<step>`, `#topology/<run>`; the older `#<run>/<group>` still works. */
export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.split('?', 2) as [string, string?];
  const tab = new URLSearchParams(query).get('tab') || null;
  const parts = path.replace(/^#\/?/, '').split('/');
  const [head, ...rest] = parts;
  if (head === 'queue') return { view: 'queue', run: null, group: null, step: null, tab: null };
  if (head === 'topology')
    return { view: 'topology', run: decode(rest[0]), group: null, step: null, tab: null };
  if (head === 'pipelines' || head === 'workflows') {
    // `#pipelines/actions/<id>` and `#pipelines/system/<kind>`; one part is always a pipeline
    const section = decode(rest[0]);
    const id = decode(rest[1]);
    if (head === 'pipelines' && isPipelineSection(section) && id !== null)
      return {
        view: 'pipelines',
        run: id,
        group: section,
        step: section === 'system' && decode(rest[2]) === 'global' ? 'global' : null,
        tab: null,
      };
    return { view: 'pipelines', run: section, group: null, step: null, tab: null };
  }
  if (head === 'specialists') {
    // the former «General settings» entry of the specialists list
    if (decode(rest[0]) === '_settings') return settingsRoute(null, null, null);
    return { view: 'specialists', run: decode(rest[0]), group: null, step: null, tab: null };
  }
  if (head === 'settings') return settingsRoute(decode(rest[0]), decode(rest[1]), decode(rest[2]));
  if (head === 'runs') {
    return {
      view: 'runs',
      run: decode(rest[0]),
      group: decode(rest[1]),
      step: decode(rest[2]),
      tab,
    };
  }
  return { view: 'runs', run: decode(head), group: decode(rest[0]), step: null, tab };
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
    const slug =
      scope === 'global' && (group === 'specialists' || group === 'pipelines')
        ? route.step
        : scope === 'global' && group === 'observers'
          ? observerTabOf(route.step)
          : null;
    return `#settings/${scope}/${group}${slug === null ? '' : `/${enc(slug)}`}`;
  }
  if (route.view === 'pipelines') {
    if (!route.run) return '#pipelines';
    return isPipelineSection(route.group)
      ? `#pipelines/${route.group}/${enc(route.run)}${
          route.group === 'system' && route.step === 'global' ? '/global' : ''
        }`
      : `#pipelines/${enc(route.run)}`;
  }
  if (!route.run) return '#runs';
  const parts = [route.run, route.group, route.group ? route.step : null].filter(
    (part): part is string => part !== null,
  );
  const tab = route.group && route.tab && route.tab !== 'log' ? `?tab=${enc(route.tab)}` : '';
  return `#runs/${parts.map(enc).join('/')}${tab}`;
}
