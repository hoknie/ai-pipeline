import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ObserverHistoryQuery } from '../../../../shared/api/observerHistoryApi.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { HistoryFilterFields } from './HistoryFilterFields.tsx';

type HistoryControls = {
  filters: ObserverHistoryQuery;
  update: (patch: Partial<ObserverHistoryQuery>) => void;
  reset: () => void;
};

/** Whether any filter narrows the history; the page size is not a filter. */
export function hasFilter(filters: ObserverHistoryQuery): boolean {
  return (
    filters.repository !== undefined ||
    filters.result !== undefined ||
    filters.model !== undefined ||
    filters.runtime !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined
  );
}

/** The filters of the history above the list, with «Reset» once any of them is set. */
export function HistoryFilters({
  history,
  projects,
}: {
  history: HistoryControls;
  projects: string[];
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b p-3">
      <HistoryFilterFields history={history} projects={projects} />
      {hasFilter(history.filters) ? (
        <Button variant="ghost" size="sm" className="w-fit" onClick={history.reset}>
          <RotateCcw aria-hidden="true" />
          {t('observers.history.reset')}
        </Button>
      ) : null}
    </div>
  );
}
