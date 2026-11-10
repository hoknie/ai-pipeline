import { useEffect, useMemo, useState } from 'react';

import { usePreference } from '../../../shared/lib/browser/preferences.ts';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import {
  EMPTY_PIPELINE_FILTER,
  activePipelineFilterCount,
  existingPipelineFilter,
  pipelineFilterOptions,
  savedPipelineFilter,
  type PipelineFilter,
} from '../pipelineFilters.ts';

/** The filter of the list and the search text; the filter is kept per repository. */
export function usePipelineFilterState(view: ConfigEditorResponse | null) {
  const [savedByRepository, setSavedByRepository] = usePreference<Record<string, unknown>>(
    'pipelineFilters',
    {},
  );
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = usePreference<boolean>('pipelineFiltersCollapsed', false);
  const repository = view?.repository ?? null;
  const options = useMemo(() => pipelineFilterOptions(view?.pipelines ?? []), [view]);
  const stored = useMemo<PipelineFilter>(
    () =>
      repository === null
        ? EMPTY_PIPELINE_FILTER
        : savedPipelineFilter(savedByRepository[repository]),
    [savedByRepository, repository],
  );
  const filter = useMemo(() => existingPipelineFilter(stored, options), [stored, options]);
  const setFilter = (next: PipelineFilter) => {
    if (repository === null) return;
    setSavedByRepository({ ...savedByRepository, [repository]: next });
  };
  // a value nobody has any more drops out of the saved choice
  useEffect(() => {
    if (view && repository !== null && JSON.stringify(filter) !== JSON.stringify(stored)) {
      setSavedByRepository({ ...savedByRepository, [repository]: filter });
    }
  }, [view, repository, filter, stored, savedByRepository, setSavedByRepository]);
  const count = activePipelineFilterCount(filter, search);
  return {
    repository,
    options,
    filter,
    setFilter,
    search,
    setSearch,
    collapsed,
    setCollapsed,
    count,
  };
}

export type PipelineFilterState = ReturnType<typeof usePipelineFilterState>;
