import type { ObserverHistoryQuery } from '../../../../shared/api/observerHistoryApi.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { HistoryFilterFields } from './HistoryFilterFields.tsx';

type HistoryControls = {
  filters: ObserverHistoryQuery;
  update: (patch: Partial<ObserverHistoryQuery>) => void;
  reset: () => void;
};

export function HistoryFilters({
  history,
  projects,
}: {
  history: HistoryControls;
  projects: string[];
}) {
  const { t } = useTranslation();
  const fieldClass = 'rounded border bg-background p-2';
  return (
    <>
      <HistoryFilterFields history={history} projects={projects} />
      <div className="flex gap-2">
        <Button variant="outline" onClick={history.reset}>
          {t('observers.history.reset')}
        </Button>
        <select
          aria-label={t('observers.history.pageSize')}
          value={history.filters.limit ?? 20}
          onChange={(e) => history.update({ limit: Number(e.target.value) as 20 | 50 | 100 })}
          className={fieldClass}
        >
          {[20, 50, 100].map((size) => (
            <option key={size}>{size}</option>
          ))}
        </select>
      </div>
    </>
  );
}
import { useTranslation } from 'react-i18next';
