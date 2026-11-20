import {
  agentTabOf,
  observerTabOf,
  settingsLocationOf,
  swarmLegacyTab,
  swarmTabOf,
} from './settingsGroups.ts';

export type View =
  'runs' | 'queue' | 'specialists' | 'pipelines' | 'providers' | 'stats' | 'settings';

export interface Route {
  view: View;
  /**
   * Run on the runs tab, `new` on the queue tab for the page of a new task, specialist (or `new`) on the specialists
   * tab, group of settings on the settings tab; on the pipeline tab the id of a pipeline, of an
   * action or of a system stage.
   */
  run: string | null;
  /**
   * On the runs tab the group of a run; on the settings tab the tab of the page (`global`,
   * `project`); on the pipeline tab the section (`actions`, `system`, `topology`), null for the pipelines.
   */
  group: string | null;
  /** Step whose last attempt is opened in the group. */
  step: string | null;
  /** Tab of the group screen; null for the default log tab. */
  tab: string | null;
  /** The section of a pipeline entry on the settings tab «Swarm» (`actions`, `system`, `topology`). */
  section?: string | null;
  /** The variant of the topology section on the settings tab «Swarm». */
  variant?: string | null;
  /** The preset of a new provider on the settings tab «Swarm» (`?preset=`). */
  preset?: string | null;
  /** Slug of the project of an entry of the specialists or pipelines tab (`?project=`); null: a shared one. */
  project?: string | null;
  /** The author filter of the runs, the queue and the statistics (`?author=`): a user id or `me`; absent: everybody. */
  author?: string | null;
}

/** Groups of the shared tab whose third address part opens an entry (a slug, an id or `new`). */
const SLUG_GROUPS: ReadonlySet<string> = new Set(['projects', 'runtimes']);

/** The route of the group «Swarm»: the tab of the window in `tab`, its entry in `step`. */
function swarmRoute(first: string | null, second: string | null, parts: (string | null)[]) {
  const { scope } = settingsLocationOf(first, second);
  const legacy = swarmLegacyTab(first, second);
  // an old address of the shared tab: the entry follows the group; a new one: the tab comes first
  const [tabPart, one, two, three] =
    legacy === null ? parts : [legacy, parts[0] ?? null, null, null];
  const tab = swarmTabOf(tabPart ?? null);
  const isSection = tab === 'pipelines' && isPipelineSection(one ?? null);
  const sectioned = isSection && two !== null;
  return {
    view: 'settings' as const,
    run: 'swarm',
    group: scope,
    step: sectioned ? (two ?? null) : isSection ? null : (one ?? null),
    tab,
    section: isSection ? (one ?? null) : null,
    variant: sectioned && one === 'topology' ? (three ?? null) : null,
  } satisfies Route;
}

/** The settings route of `#settings/<tab>/<group>`, or of an old `#settings/<group>`. */
function settingsRoute(
  first: string | null,
  second: string | null,
  third: string | null,
  rest: (string | null)[] = [],
): Route {
  const { scope, group } = settingsLocationOf(first, second);
  if (group === 'swarm') {
    // `#settings/<tab>/swarm/<window tab>/…` carries the tab from the third part; an old one has the entry there
    return swarmRoute(
      first,
      second,
      swarmLegacyTab(first, second) === null ? [third, ...rest] : [third],
    );
  }
  // a shared specialist (or `new`) of the group «Specialists» is the third part; for the
  // observers it is the tab of the group
  const step =
    scope === 'global' && SLUG_GROUPS.has(group)
      ? third
      : scope === 'global' && group === 'observers' && third !== null
        ? observerTabOf(third)
        : group === 'agents' && third !== null
          ? agentTabOf(third)
          : null;
  return { view: 'settings', run: group, group: scope, step, tab: null };
}

/** Sections of the pipeline list other than the pipelines. */
export const PIPELINE_SECTIONS = ['actions', 'system', 'topology'] as const;
export type PipelineSection = (typeof PIPELINE_SECTIONS)[number];

export const isPipelineSection = (value: string | null): value is PipelineSection =>
  PIPELINE_SECTIONS.some((section) => section === value);

/** Periods of the statistics page; the first is the default. */
export const STATS_PERIODS = ['30d', '7d', '90d', 'all'] as const;
export type StatsPeriodId = (typeof STATS_PERIODS)[number];

export const statsPeriodOf = (value: string | null): StatsPeriodId =>
  STATS_PERIODS.find((period) => period === value) ?? '30d';

const decode = (part: string | undefined) => (part ? decodeURIComponent(part) : null);

/** `#runs/<run>/<group>/<step>`, the older `#topology/<pipeline>` opens the topology section; the older `#<run>/<group>` still works. */
export function parseRoute(hash: string): Route {
  const route = withAuthor(parseBase(hash), hash);
  if (route.view !== 'specialists' && route.view !== 'pipelines' && route.view !== 'providers') {
    return route;
  }
  const project = new URLSearchParams(hash.split('?', 2)[1] ?? '').get('project') || null;
  return project === null ? route : { ...route, project };
}

const AUTHOR_VIEWS: ReadonlySet<View> = new Set<View>(['runs', 'queue', 'stats']);

/** The `author` of the address on the views that filter by it. */
function withAuthor(route: Route, hash: string): Route {
  if (!AUTHOR_VIEWS.has(route.view)) return route;
  const author = new URLSearchParams(hash.split('?', 2)[1] ?? '').get('author') || null;
  return author === null ? route : { ...route, author };
}

function parseBase(hash: string): Route {
  const [path = '', query = ''] = hash.split('?', 2) as [string, string?];
  const params = new URLSearchParams(query);
  const tab = params.get('tab') || null;
  const parts = path.replace(/^#\/?/, '').split('/');
  const [head, ...rest] = parts;
  if (head === 'queue') {
    // `#queue/new` is the page of a new task; any other part is the queue itself
    const run = decode(rest[0]) === 'new' ? 'new' : null;
    return { view: 'queue', run, group: null, step: null, tab: null };
  }
  if (head === 'providers') {
    // `#providers/roles` is the tab «Roles»; `new` (with `?preset=`) or a slug is the form
    const first = decode(rest[0]);
    if (first === 'roles')
      return { view: 'providers', run: null, group: 'roles', step: null, tab: null };
    return {
      view: 'providers',
      run: first,
      group: null,
      step: null,
      tab: first === 'new' ? params.get('preset') || null : null,
    };
  }
  if (head === 'stats')
    return {
      view: 'stats',
      run: params.get('project') || null,
      group: statsPeriodOf(params.get('period')),
      step: null,
      tab: null,
    };
  if (head === 'topology')
    return { view: 'pipelines', run: decode(rest[0]), group: 'topology', step: null, tab: null };
  if (head === 'pipelines' || head === 'workflows') {
    // `#pipelines/actions/<id>` and `#pipelines/system/<kind>`; one part is always a pipeline
    const section = decode(rest[0]);
    const id = decode(rest[1]);
    if (head === 'pipelines' && isPipelineSection(section) && id !== null)
      return {
        view: 'pipelines',
        run: id,
        group: section,
        // `#pipelines/topology/<id>/<variant>`: the variant of the topology
        step: section === 'topology' ? decode(rest[2]) : null,
        tab: null,
      };
    return { view: 'pipelines', run: section, group: null, step: null, tab: null };
  }
  if (head === 'specialists') {
    // the former «General settings» entry of the specialists list
    if (decode(rest[0]) === '_settings') return settingsRoute(null, null, null);
    if (decode(rest[0]) === 'chains') {
      return {
        view: 'specialists',
        run: decode(rest[1]),
        group: 'chains',
        step: null,
        tab: null,
      };
    }
    return { view: 'specialists', run: decode(rest[0]), group: null, step: null, tab: null };
  }
  if (head === 'settings') {
    const route = settingsRoute(decode(rest[0]), decode(rest[1]), decode(rest[2]), [
      decode(rest[3]),
      decode(rest[4]),
      decode(rest[5]),
    ]);
    return route.run === 'swarm' && params.get('preset')
      ? { ...route, preset: params.get('preset') }
      : route;
  }
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
  const base = withAuthorQuery(formatBase(route), route);
  const withProject =
    route.view === 'specialists' || route.view === 'pipelines' || route.view === 'providers';
  if (!route.project || !withProject) return base;
  return `${base}${base.includes('?') ? '&' : '?'}project=${encodeURIComponent(route.project)}`;
}

/** The author filter appended to the address of a view that has it. */
function withAuthorQuery(base: string, route: Route): string {
  if (!route.author || !AUTHOR_VIEWS.has(route.view)) return base;
  return `${base}${base.includes('?') ? '&' : '?'}author=${encodeURIComponent(route.author)}`;
}

/** `#settings/<tab>/swarm/<window tab>[/<entry>|/<section>/<id>]`. */
function swarmHash(scope: string, route: Route): string {
  const enc = encodeURIComponent;
  // an old route names the group of the shared tab (`chains`) instead of the tab of the window
  const tab = swarmTabOf(route.tab ?? swarmLegacyTab(route.group, route.run));
  const entry = route.step === null ? '' : `/${enc(route.step)}`;
  const section = tab === 'pipelines' && route.section ? `/${route.section}` : '';
  const variant =
    tab === 'pipelines' && route.section === 'topology' && route.step && route.variant
      ? `/${enc(route.variant)}`
      : '';
  const preset =
    tab === 'providers' && route.step === 'new' && route.preset
      ? `?preset=${enc(route.preset)}`
      : '';
  return `#settings/${scope}/swarm/${tab}${section}${entry}${variant}${preset}`;
}

function formatBase(route: Route): string {
  const enc = encodeURIComponent;
  if (route.view === 'queue') return route.run === 'new' ? '#queue/new' : '#queue';
  if (route.view === 'providers') {
    if (route.group === 'roles') return '#providers/roles';
    if (!route.run) return '#providers';
    const preset = route.run === 'new' && route.tab ? `?preset=${enc(route.tab)}` : '';
    return `#providers/${enc(route.run)}${preset}`;
  }
  if (route.view === 'stats') {
    const project = route.run ? `&project=${enc(route.run)}` : '';
    return `#stats?period=${statsPeriodOf(route.group)}${project}`;
  }
  if (route.view === 'specialists') {
    if (route.group === 'chains') {
      return route.run ? `#specialists/chains/${enc(route.run)}` : '#specialists/chains';
    }
    return route.run ? `#specialists/${enc(route.run)}` : '#specialists';
  }
  if (route.view === 'settings') {
    const place = settingsLocationOf(route.group, route.run);
    if (place.group === 'swarm') return swarmHash(place.scope, route);
    // an old route with the group only (`run`) leads to its new place
    const { scope, group } = route.group === null ? settingsLocationOf(route.run, null) : place;
    const slug =
      scope === 'global' && SLUG_GROUPS.has(group)
        ? route.step
        : scope === 'global' && group === 'observers'
          ? observerTabOf(route.step)
          : group === 'agents' && agentTabOf(route.step) !== 'general'
            ? agentTabOf(route.step)
            : null;
    return `#settings/${scope}/${group}${slug === null ? '' : `/${enc(slug)}`}`;
  }
  if (route.view === 'pipelines') {
    if (!route.run) return '#pipelines';
    if (route.group === 'topology' && route.step)
      return `#pipelines/topology/${enc(route.run)}/${enc(route.step)}`;
    return isPipelineSection(route.group)
      ? `#pipelines/${route.group}/${enc(route.run)}`
      : `#pipelines/${enc(route.run)}`;
  }
  if (!route.run) return '#runs';
  const parts = [route.run, route.group, route.group ? route.step : null].filter(
    (part): part is string => part !== null,
  );
  const tab = route.group && route.tab && route.tab !== 'log' ? `?tab=${enc(route.tab)}` : '';
  return `#runs/${parts.map(enc).join('/')}${tab}`;
}
