import { useEffect } from 'react';

import type { RunView } from '../../shared/api/types.ts';
import type { Route } from '../../shared/lib/nav/route.ts';

/** Opens the first run of the repository, and follows a link into a run of another repository. */
export function useRouteEffects(
  route: Route,
  runs: RunView[],
  selected: string | null,
  setRoute: (update: (current: Route) => Route) => void,
  setChosen: (path: string) => void,
): void {
  const first = runs.find((candidate) => candidate.repository === selected);
  useEffect(() => {
    if (route.view === 'runs' && route.run === null && first)
      setRoute((current) => ({ ...current, run: first.id }));
  }, [route.view, route.run, first, setRoute]);

  // An address or a link that opens a run of another repository selects that repository.
  const routedRepository =
    route.view === 'runs' && route.run
      ? (runs.find((candidate) => candidate.id === route.run)?.repository ?? null)
      : null;
  useEffect(() => {
    if (routedRepository !== null && routedRepository !== selected) setChosen(routedRepository);
  }, [routedRepository, selected, setChosen]);
}
