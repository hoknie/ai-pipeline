import { History, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Api } from '../../../../shared/api/api.ts';
import { Alert } from '../../../../shared/ui/feedback/alert.tsx';
import { Empty } from '../../../../shared/ui/feedback/empty.tsx';
import { Skeleton } from '../../../../shared/ui/feedback/skeleton.tsx';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { Card } from '../../../../shared/ui/layout/card.tsx';
import { useHistory } from '../useHistory.ts';
import { HistoryFilters, hasFilter } from './HistoryFilters.tsx';
import { HistoryList } from './HistoryList.tsx';
import { HistoryPagination } from './HistoryPagination.tsx';

export function HistoryTab({ api }: { api: Api }) {
  const { t } = useTranslation();
  const history = useHistory(api);
  const page = history.page;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!page?.items.some((it) => it.result === 'running')) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [page]);

  const filtered = hasFilter(history.filters);

  return (
    <section className="@container min-w-0" aria-label={t('observers.history.title')}>
      <Card className="overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h3 className="text-sm font-semibold">{t('observers.history.title')}</h3>
          <Button variant="outline" size="sm" loading={history.busy} onClick={history.refresh}>
            <RefreshCw aria-hidden="true" />
            {t('observers.history.refresh')}
          </Button>
        </header>
        <HistoryFilters history={history} projects={page?.projects ?? []} />
        {history.error ? (
          <Alert variant="destructive" className="m-3 flex w-auto items-center justify-between">
            <span>{t('observers.history.error')}</span>
            <Button variant="outline" size="sm" onClick={history.retry}>
              {t('observers.history.retry')}
            </Button>
          </Alert>
        ) : null}
        {history.busy && !page ? (
          <div
            role="status"
            aria-label={t('observers.history.loading')}
            className="flex flex-col gap-2 p-3"
          >
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-12" />
            ))}
          </div>
        ) : null}
        {page && !page.items.length ? (
          <Empty
            icon={<History />}
            title={t(filtered ? 'observers.history.noMatches' : 'observers.history.empty')}
          >
            {filtered ? (
              <Button variant="outline" size="sm" onClick={history.reset}>
                {t('observers.history.reset')}
              </Button>
            ) : null}
          </Empty>
        ) : null}
        {page?.items.length ? <HistoryList page={page} asOf={now} /> : null}
        <HistoryPagination
          history={history}
          pageSize={history.filters.limit ?? 20}
          onPageSize={(limit) => history.update({ limit })}
        />
      </Card>
    </section>
  );
}
