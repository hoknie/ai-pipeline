import { useTranslation } from 'react-i18next';

import { FilterColumn } from '../../../shared/ui/layout/FilterColumn.tsx';
import { FiltersButton } from '../../../shared/ui/layout/FiltersButton.tsx';
import { RunFilters } from '../list/RunFilters.tsx';
import type { FilterProps } from './types.ts';

/** The filters of the runs behind a button: a popover in a wide window, a sheet in a narrow one. */
export function RunFiltersButton({
  filterProps,
  count,
  wide,
}: {
  filterProps: FilterProps;
  count: number;
  wide: boolean;
}) {
  const { t } = useTranslation();
  return (
    <FiltersButton
      label={t('runs.list.filters')}
      countLabel={count > 0 ? t('runs.list.filtersCount', { count }) : null}
      wide={wide}
    >
      <RunFilters {...filterProps} />
    </FiltersButton>
  );
}

/** The column of the filters of the runs, collapsible into a strip. */
export function RunFilterColumn(props: {
  filterProps: FilterProps;
  count: number;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <FilterColumn
      label={t('runs.list.filters')}
      count={props.count}
      countLabel={t('runs.list.filtersCount', { count: props.count })}
      collapsed={props.collapsed}
      onCollapsed={props.onCollapsed}
    >
      <RunFilters {...props.filterProps} />
    </FilterColumn>
  );
}
