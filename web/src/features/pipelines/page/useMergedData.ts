import { useMemo } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import type { useAllProjectsConfig } from '../../../shared/api/catalog/useAllProjectsConfig.ts';
import { mergeRows, splitRowKey } from '../../../shared/lib/catalog/projectRows.ts';
import { actionsOf, type ActionEntry } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import type { PipelinesData } from './usePipelinesData.ts';

/** The configuration the page shows: the one of the project, or the merged one in the mode. */
export function useMergedData(
  api: Api,
  single: PipelinesData,
  all: ReturnType<typeof useAllProjectsConfig>,
  merged: boolean,
) {
  const { configs, reload } = all;
  const view = useMemo(() => {
    const first = configs?.find((config) => config.view !== null)?.view ?? null;
    if (!merged || first === null) return null;
    return {
      ...first,
      repository: '*',
      pipelines: mergeRows(
        (configs ?? []).map((c) => ({ project: c.project, entries: c.view?.pipelines ?? null })),
        (entry) => entry.id,
      ),
      specialists: mergeRows(
        (configs ?? []).map((c) => ({ project: c.project, entries: c.view?.specialists ?? null })),
        (entry) => entry.slug,
      ),
      actions: mergeRows(
        (configs ?? []).map((c) => ({
          project: c.project,
          entries: c.view ? actionsOf(c.view) : null,
        })),
        (entry: ActionEntry) => entry.id,
      ),
      errors: [],
    } as ConfigEditorResponse;
  }, [configs, merged]);
  const failure = merged
    ? (configs ?? [])
        .flatMap((config) =>
          config.error === null ? [] : [`${config.project.label}: ${config.error}`],
        )
        .join('\n') || null
    : single.failure;
  const data: PipelinesData = merged
    ? {
        ...single,
        view,
        failure,
        load: async () => {
          await reload();
          return single.load();
        },
        reload: async () => {
          await reload();
        },
      }
    : single;
  const contextOf = (key: string | null) => {
    const { project, id } = splitRowKey(key ?? '');
    const found = (configs ?? []).find((config) =>
      project === null
        ? [...(config.view?.pipelines ?? []), ...(config.view ? actionsOf(config.view) : [])].some(
            (entry) => entry.id === id && entry.level === 'global',
          )
        : config.project.slug === project,
    );
    const owner = found?.project ?? configs?.[0]?.project ?? null;
    const rowApi = owner === null ? api : api.forRepository(owner.path);
    const rowView = found?.view ?? configs?.find((config) => config.view)?.view ?? null;
    return {
      api: rowApi,
      view: rowView,
      slug: project,
      load: async () => {
        const fresh = await rowApi.config().catch(() => null);
        await reload();
        return fresh;
      },
    };
  };
  return { data, contextOf };
}

/** The api, the configuration and the project of one entry of the merged lists. */
export type EntryContext = ReturnType<ReturnType<typeof useMergedData>['contextOf']>;

/** The data of the page with the configuration and the reloading of the project of an entry. */
export function dataIn(data: PipelinesData, context: EntryContext | undefined): PipelinesData {
  if (!context) return data;
  return {
    ...data,
    view: context.view,
    load: context.load,
    reload: async () => void (await context.load()),
  };
}
