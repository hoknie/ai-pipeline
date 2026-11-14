import type { Route, View } from '../../shared/lib/nav/route.ts';

/** Where a click on a section tab leads from the current route. */
export function tabRoute(view: View, route: Route, lastRun: string | null): Route {
  const open = (value: string | null, group: string | null = null): Route => ({
    view,
    run: value,
    group,
    step: null,
    tab: null,
  });
  if (view === route.view) return view === 'queue' && route.run === 'new' ? open(null) : route;
  if (view === 'settings') return open('general', 'global');
  if (view === 'runs') return open(lastRun);
  return open(null);
}
