import { PipelineFilters } from '../PipelineFilters.tsx';
import type { PipelineFilterState } from './usePipelineFilterState.ts';

/** The fields of the filter. */
export function FiltersPanel({ filters }: { filters: PipelineFilterState }) {
  return (
    <PipelineFilters
      filter={filters.filter}
      options={filters.options}
      search={filters.search}
      onFilter={filters.setFilter}
      onSearch={filters.setSearch}
    />
  );
}
