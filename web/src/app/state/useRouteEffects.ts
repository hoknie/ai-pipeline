import { useEffect } from 'react';

import type { RepositoryView, RunView } from '../../shared/api/types.ts';
import type { Route } from '../../shared/lib/nav/route.ts';

/** Opens the first run of the repository, and follows a link into a run of another repository. */
export function useRouteEffects(
  route: Route,
  runs: RunView[],
  selected: string | null,
  setRoute: (update: (current: Route) => Route) => void,
  panel: {
    /** The mode «All projects»: links do not leave it. */
    allProjects: boolean;
    setChosen: (path: string) => void;
    registry: readonly RepositoryView[];
    /** Whether a repository is a disabled project: a run of one does not select it. */
    disabled: (repository: string) => boolean;
  },
): void {
  const { allProjects, setChosen, registry, disabled } = panel;
  const first = runs.find((candidate) => allProjects || candidate.repository === selected);
  useEffect(() => {
    if (route.view === 'runs' && route.run === null && first)
      setRoute((current) => ({ ...current, run: first.id }));
  }, [route.view, route.run, first, setRoute]);

  // An address or a link that opens a run of another repository selects that repository,
  // unless the panel does not offer it (a disabled project).
  const found =
    route.view === 'runs' && route.run
      ? (runs.find((candidate) => candidate.id === route.run)?.repository ?? null)
      : null;
  // An address of an entry of a project (`?project=<slug>`) does the same.
  const projectPath =
    route.project !== undefined && route.project !== null
      ? (registry.find((entry) => entry.slug === route.project)?.path ?? null)
      : null;
  const target = found ?? projectPath;
  const routedRepository = target !== null && !disabled(target) ? target : null;
  useEffect(() => {
    if (!allProjects && routedRepository !== null && routedRepository !== selected)
      setChosen(routedRepository);
  }, [allProjects, routedRepository, selected, setChosen]);
}
