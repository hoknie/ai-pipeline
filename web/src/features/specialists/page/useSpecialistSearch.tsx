import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePreference } from '../../../shared/lib/browser/preferences.ts';
import { FiltersButton } from '../../../shared/ui/layout/FiltersButton.tsx';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { EMPTY_FILTER, activeFilterCount, applyFilter } from '../specialistFilters.ts';
import { SpecialistFilters } from '../SpecialistFilters.tsx';
import { useSpecialistFilter } from './useSpecialistFilter.ts';

/** The search text and the filter of the list, the filtered list and the panel that edits them. */
export function useSpecialistSearch(view: ConfigEditorResponse | null, columns: boolean) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = usePreference<boolean>('specialistFiltersCollapsed', false);
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
  const count = activeFilterCount(filter, search);
  const label = t('specialists.filters.button');
  return {
    /** The props of `SplitPage` that put the filters into a collapsible column. */
    column: {
      filters: columns ? panel : null,
      filtersLabel: label,
      filtersCount: count,
      filtersCountLabel: t('specialists.filters.buttonCount', { count }),
      filtersCollapsed: collapsed,
      onFiltersCollapsed: setCollapsed,
    },
    /** The button of the filters below 1280 px. */
    button: (wide: boolean) =>
      view && !columns ? (
        <FiltersButton
          label={label}
          countLabel={count > 0 ? t('specialists.filters.buttonCount', { count }) : null}
          wide={wide}
        >
          {panel}
        </FiltersButton>
      ) : null,
    shown: applyFilter(view?.specialists ?? [], filter, search),
    count,
    reset: () => {
      setFilter(EMPTY_FILTER);
      setSearch('');
    },
  };
}
