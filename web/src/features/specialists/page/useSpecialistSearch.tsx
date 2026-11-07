import { useState } from 'react';

import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { EMPTY_FILTER, activeFilterCount, applyFilter } from '../specialistFilters.ts';
import { SpecialistFilters } from '../SpecialistFilters.tsx';
import { useSpecialistFilter } from './useSpecialistFilter.ts';

/** The search text and the filter of the list, the filtered list and the panel that edits them. */
export function useSpecialistSearch(view: ConfigEditorResponse | null) {
  const [search, setSearch] = useState('');
  const { filter, setFilter, options } = useSpecialistFilter(
    view?.specialists ?? [],
    view?.repository ?? null,
    view !== null,
  );
  const panel = view ? (
    <SpecialistFilters
      filter={filter}
      options={options}
      search={search}
      onFilter={setFilter}
      onSearch={setSearch}
    />
  ) : null;
  return {
    panel,
    shown: applyFilter(view?.specialists ?? [], filter, search),
    count: activeFilterCount(filter, search),
    reset: () => {
      setFilter(EMPTY_FILTER);
      setSearch('');
    },
  };
}
