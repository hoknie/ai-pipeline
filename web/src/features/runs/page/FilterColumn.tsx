import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { RunFilters } from '../list/RunFilters.tsx';
import type { FilterProps } from './types.ts';
import { FILTERS_WIDTH, STRIP_WIDTH } from './widths.ts';

/** The column of the filters: expanded, or a strip with the count of the active ones. */
export function FilterColumn({
  filterProps,
  count,
  collapsed,
  onCollapsed,
}: {
  filterProps: FilterProps;
  count: number;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
}) {
  const { t } = useTranslation();
  return collapsed ? (
    <aside
      aria-label={t('runs.list.filters')}
      data-filters="collapsed"
      style={{ width: STRIP_WIDTH }}
      className="flex shrink-0 flex-col items-center gap-2 border-r py-3"
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('runs.list.expand')}
        title={t('runs.list.expand')}
        onClick={() => onCollapsed(false)}
      >
        <PanelLeftOpen />
      </Button>
      {count > 0 ? (
        <span
          aria-label={t('runs.list.filtersCount', { count })}
          className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
        >
          {count}
        </span>
      ) : null}
    </aside>
  ) : (
    <aside
      aria-label={t('runs.list.filters')}
      data-filters="expanded"
      style={{ width: FILTERS_WIDTH }}
      className="flex shrink-0 flex-col gap-2 overflow-y-auto border-r p-3"
    >
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        aria-label={t('runs.list.collapse')}
        onClick={() => onCollapsed(true)}
      >
        <PanelLeftClose />
        {t('runs.list.collapse')}
      </Button>
      <RunFilters {...filterProps} />
    </aside>
  );
}
