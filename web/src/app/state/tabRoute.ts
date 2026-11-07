import type { RunView } from '../../shared/api/types.ts';
import type { Route, View } from '../../shared/lib/nav/route.ts';

/** Where a click on a section tab leads from the current route. */
export function tabRoute(
  view: View,
  route: Route,
  run: RunView | null,
  lastRun: string | null,
): Route {
  if (view === route.view) return route;
  const open = (value: string | null, group: string | null = null): Route => ({
    view,
    run: value,
    group,
    step: null,
    tab: null,
  });
  if (view === 'queue' || view === 'specialists' || view === 'pipelines') return open(null);
  if (view === 'settings') return open('general', 'global');
  if (view === 'topology') return open(run?.pipeline ?? null);
  return open(lastRun);
}
