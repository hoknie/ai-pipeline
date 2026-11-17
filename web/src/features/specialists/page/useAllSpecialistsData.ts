import { useMemo } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { useAllProjectsConfig } from '../../../shared/api/catalog/useAllProjectsConfig.ts';
import { groupRows, type ProjectRef } from '../../../shared/lib/catalog/projectRows.ts';
import type { useSpecialistsData } from './useSpecialistsData.ts';

/** The data of a specialists page, of one project or grouped from several. */
export type SpecialistsSource = ReturnType<typeof useSpecialistsData> & {
  /** Why the configuration of a project could not be read, one line per project. */
  failures: string[];
};

/**
 * The specialists and chains of every project grouped by slug: one row per slug with the projects
 * that have it. The view is the configuration of the first readable project with the grouped
 * rows, so that the list and its filters need no other source.
 */
export function useAllSpecialistsData(
  api: Api,
  projects: readonly ProjectRef[],
  single: ReturnType<typeof useSpecialistsData>,
): SpecialistsSource {
  const { configs, reload } = useAllProjectsConfig(api, projects);
  const first = configs?.find((config) => config.view !== null)?.view ?? null;
  const grouped = useMemo(() => {
    const sources = (configs ?? []).map((config) => ({
      project: config.project,
      view: config.view,
    }));
    return {
      specialists: groupRows(
        sources.map((s) => ({ project: s.project, entries: s.view?.specialists ?? null })),
        (entry) => entry.slug,
      ),
      chains: groupRows(
        sources.map((s) => ({ project: s.project, entries: s.view?.chains ?? null })),
        (entry) => entry.slug,
      ),
    };
  }, [configs]);
  const failures = (configs ?? []).flatMap((config) =>
    config.error === null ? [] : [`${config.project.label}: ${config.error}`],
  );
  const view = useMemo(
    () =>
      first === null
        ? null
        : { ...first, repository: '*', ...grouped, errors: [] as ConfigEditorResponse['errors'] },
    [first, grouped],
  );
  return {
    ...single,
    view,
    failure: failures.length > 0 && view === null ? failures.join('\n') : single.failure,
    failures,
    load: async () => {
      await Promise.all([reload(), single.load()]);
    },
  };
}
