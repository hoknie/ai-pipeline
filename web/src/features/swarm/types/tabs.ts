import type { Route } from '../../../shared/lib/nav/route.ts';
import { SWARM_TABS, swarmTabOf, type SwarmTab } from '../../../shared/lib/nav/settingsGroups.ts';

export { SWARM_TABS, swarmTabOf, type SwarmTab };

/** The part of the configuration the window works on: the selected project, or the shared level. */
export type SwarmScope = 'project' | 'global';

/** A place of the window: a tab and what is open in it. */
export interface SwarmTarget {
  tab: SwarmTab;
  /** The slug, the id or `new` of the open entry; null for the tab itself. */
  entry: string | null;
  /** The section of the tab «Pipeline» (`actions`, `system`, `topology`). */
  section?: string | null;
  /** The variant of the topology section of the tab «Pipeline». */
  variant?: string | null;
  /** The preset of a new provider. */
  preset?: string | null;
  /** The project of an entry in the mode «All projects». */
  project?: string | null;
}

/** The tab of a route of the top bar (`#providers…`, `#specialists…`, `#pipelines…`); null for another view. */
export function swarmTabOfRoute(route: Route): SwarmTab | null {
  if (route.view === 'providers') return route.group === 'roles' ? 'roles' : 'providers';
  if (route.view === 'specialists') return route.group === 'chains' ? 'chains' : 'specialists';
  return route.view === 'pipelines' ? 'pipelines' : null;
}

/** What a route of the top bar opens in the window. */
export function swarmTargetOfRoute(route: Route): SwarmTarget {
  const tab = swarmTabOfRoute(route) ?? 'specialists';
  const common = { project: route.project ?? null };
  if (tab === 'roles') return { tab, entry: null, ...common };
  if (tab === 'providers') return { tab, entry: route.run, preset: route.tab, ...common };
  if (tab === 'pipelines') {
    return { tab, entry: route.run, section: route.group, variant: route.step, ...common };
  }
  return { tab, entry: route.run, ...common };
}

/** The route of the top bar of a place of the window. */
export function routeOfSwarmTarget(target: SwarmTarget): Route {
  const project = target.project ?? null;
  const base = { step: null, tab: null, project };
  switch (target.tab) {
    case 'providers':
      return {
        ...base,
        view: 'providers',
        run: target.entry,
        group: null,
        tab: target.entry === 'new' ? (target.preset ?? null) : null,
      };
    case 'roles':
      return { ...base, view: 'providers', run: null, group: 'roles' };
    case 'chains':
      return { ...base, view: 'specialists', run: target.entry, group: 'chains' };
    case 'specialists':
      return { ...base, view: 'specialists', run: target.entry, group: null };
    case 'pipelines':
      return {
        ...base,
        view: 'pipelines',
        run: target.entry,
        group: target.section ?? null,
        step: target.variant ?? null,
      };
  }
}

/** The route of the group «Swarm» of the settings of a place of the window. */
export function settingsRouteOfSwarmTarget(scope: SwarmScope, target: SwarmTarget): Route {
  return {
    view: 'settings',
    run: 'swarm',
    group: scope,
    step: target.entry,
    tab: target.tab,
    section: target.section ?? null,
    variant: target.variant ?? null,
    preset: target.preset ?? null,
  };
}
