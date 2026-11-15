import { useMemo } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { useAllProjectsConfig } from '../../../shared/api/catalog/useAllProjectsConfig.ts';
import {
  mergeRows,
  splitRowKey,
  type ProjectRef,
} from '../../../shared/lib/catalog/projectRows.ts';
import type { useSpecialistsData } from './useSpecialistsData.ts';

/** What a form needs to read and save an entry: the api and the configuration of its project. */
export interface EntryContext {
  api: Api;
  view: ConfigEditorResponse | null;
}

/** The data of a specialists page, of one project or merged from several. */
export type SpecialistsSource = ReturnType<typeof useSpecialistsData> & {
  /** Context of the entry with the row key; absent or unknown: the one of the selected project. */
  contextOf: (key: string | null) => EntryContext;
  /** Why the configuration of a project could not be read, one line per project. */
  failures: string[];
};

/**
 * The specialists and chains of every project in one list: the shared ones once, the others
 * with their project. The view is the configuration of the first readable project with the
 * merged rows, so that the list and its filters need no other source.
 */
export function useAllSpecialistsData(
  api: Api,
  projects: readonly ProjectRef[],
  single: ReturnType<typeof useSpecialistsData>,
): SpecialistsSource {
  const { configs, reload } = useAllProjectsConfig(api, projects);
  const first = configs?.find((config) => config.view !== null)?.view ?? null;
  const merged = useMemo(() => {
    const sources = (configs ?? []).map((config) => ({
      project: config.project,
      view: config.view,
    }));
    return {
      specialists: mergeRows(
        sources.map((s) => ({ project: s.project, entries: s.view?.specialists ?? null })),
        (entry) => entry.slug,
      ),
      chains: mergeRows(
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
        : { ...first, repository: '*', ...merged, errors: [] as ConfigEditorResponse['errors'] },
    [first, merged],
  );
  const contextOf = (key: string | null): EntryContext => {
    const { project, id } = splitRowKey(key ?? '');
    const row =
      project === null ? merged.specialists.find((r) => r.slug === id && !r.project) : null;
    const chain = project === null ? merged.chains.find((r) => r.slug === id && !r.project) : null;
    const owner =
      projects.find((candidate) => candidate.slug === project) ?? row?.from ?? chain?.from ?? null;
    const path = owner?.path ?? first?.repository ?? null;
    return {
      api: path === null ? api : api.forRepository(path),
      view: configs?.find((config) => config.project.path === path)?.view ?? first,
    };
  };
  return {
    ...single,
    view,
    failure: failures.length > 0 && view === null ? failures.join('\n') : single.failure,
    failures,
    load: async () => {
      await Promise.all([reload(), single.load()]);
    },
    contextOf,
  };
}
