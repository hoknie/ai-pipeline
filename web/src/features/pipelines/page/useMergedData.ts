import { useMemo } from 'react';

import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import type { useAllProjectsConfig } from '../../../shared/api/catalog/useAllProjectsConfig.ts';
import { groupRows } from '../../../shared/lib/catalog/projectRows.ts';
import { actionsOf, type ActionEntry } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import type { PipelinesData } from './usePipelinesData.ts';

/** The configuration the page shows: the one of the project, or the grouped one in the mode. */
export function useMergedData(
  single: PipelinesData,
  all: ReturnType<typeof useAllProjectsConfig>,
  grouped: boolean,
): PipelinesData {
  const { configs, reload } = all;
  const view = useMemo(() => {
    const first = configs?.find((config) => config.view !== null)?.view ?? null;
    if (!grouped || first === null) return null;
    return {
      ...first,
      repository: '*',
      pipelines: groupRows(
        (configs ?? []).map((c) => ({ project: c.project, entries: c.view?.pipelines ?? null })),
        (entry) => entry.id,
      ),
      specialists: groupRows(
        (configs ?? []).map((c) => ({ project: c.project, entries: c.view?.specialists ?? null })),
        (entry) => entry.slug,
      ),
      actions: groupRows(
        (configs ?? []).map((c) => ({
          project: c.project,
          entries: c.view ? actionsOf(c.view) : null,
        })),
        (entry: ActionEntry) => entry.id,
      ),
      errors: [],
    } as ConfigEditorResponse;
  }, [configs, grouped]);
  if (!grouped) return single;
  const failure =
    (configs ?? [])
      .flatMap((config) =>
        config.error === null ? [] : [`${config.project.label}: ${config.error}`],
      )
      .join('\n') || null;
  return {
    ...single,
    view,
    projects: (configs ?? []).map(({ project, view: projectView }) => ({
      project,
      view: projectView,
    })),
    failure,
    load: async () => {
      await reload();
      return single.load();
    },
    reload: async () => {
      await reload();
    },
  };
}
