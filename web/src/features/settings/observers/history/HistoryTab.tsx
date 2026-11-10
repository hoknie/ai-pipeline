import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Api } from '../../../../shared/api/api.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { useHistory } from '../useHistory.ts';
import { HistoryFilters } from './HistoryFilters.tsx';
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

  const hasFilter =
    history.filters.repository !== undefined ||
    history.filters.result !== undefined ||
    history.filters.model !== undefined ||
    history.filters.runtime !== undefined ||
    history.filters.from !== undefined ||
    history.filters.to !== undefined;

  return (
    <section
      className="@container flex min-w-0 flex-col gap-3"
      aria-label={t('observers.history.title')}
    >
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('observers.history.title')}</h2>
        <Button variant="outline" loading={history.busy} onClick={history.refresh}>
          {t('observers.history.refresh')}
        </Button>
      </header>
      <HistoryFilters history={history} projects={page?.projects ?? []} />
      {history.error ? (
        <div
          role="alert"
          className="flex items-center justify-between rounded border border-destructive p-3"
        >
          <span>{t('observers.history.error')}</span>
          <Button variant="outline" size="sm" onClick={history.retry}>
            {t('observers.history.retry')}
          </Button>
        </div>
      ) : null}
      {history.busy && !page ? (
        <div
          role="status"
          aria-label={t('observers.history.loading')}
          className="h-24 animate-pulse rounded bg-muted"
        />
      ) : null}
      {page && !page.items.length ? (
        <div className="flex flex-col items-start gap-2 py-4">
          <p>{t(hasFilter ? 'observers.history.noMatches' : 'observers.history.empty')}</p>
          {hasFilter ? (
            <Button variant="outline" size="sm" onClick={history.reset}>
              {t('observers.history.reset')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {page?.items.length ? <HistoryList page={page} asOf={now} /> : null}
      <HistoryPagination history={history} />
    </section>
  );
}
