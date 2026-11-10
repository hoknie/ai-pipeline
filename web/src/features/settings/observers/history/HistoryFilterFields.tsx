import { useTranslation } from 'react-i18next';
import type { ObserverHistoryQuery } from '../../../../shared/api/observerHistoryApi.ts';

type HistoryControls = {
  filters: ObserverHistoryQuery;
  update: (patch: Partial<ObserverHistoryQuery>) => void;
};

const RESULTS = [
  'running',
  'done',
  'rejected',
  'needs_human',
  'failed',
  'cancelled',
  'unknown',
] as const;
const RUNTIMES = ['claude', 'opencode', 'agy'] as const;

function toDatetimeLocal(ms: number | undefined): string {
  if (ms === undefined) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function HistoryFilterFields({
  history,
  projects,
}: {
  history: HistoryControls;
  projects: string[];
}) {
  const { t } = useTranslation();
  const cls = 'rounded border bg-background p-2';
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 @sm:grid-cols-2 @3xl:grid-cols-3">
      <select
        aria-label={t('observers.history.project')}
        value={history.filters.repository ?? ''}
        onChange={(e) => history.update({ repository: e.target.value || undefined })}
        className={cls}
      >
        <option value="">{t('observers.history.allProjects')}</option>
        {projects.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <select
        aria-label={t('observers.history.result')}
        value={history.filters.result ?? ''}
        onChange={(e) => history.update({ result: (e.target.value || undefined) as never })}
        className={cls}
      >
        <option value="">{t('observers.history.allResults')}</option>
        {RESULTS.map((r) => (
          <option key={r} value={r}>
            {t(`observers.history.results.${r}` as never)}
          </option>
        ))}
      </select>
      <select
        aria-label={t('observers.history.runtime')}
        value={history.filters.runtime ?? ''}
        onChange={(e) => history.update({ runtime: e.target.value || undefined })}
        className={cls}
      >
        <option value="">{t('observers.history.allRuntimes')}</option>
        {RUNTIMES.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <input
        aria-label={t('observers.history.model')}
        placeholder={t('observers.history.model')}
        value={history.filters.model ?? ''}
        onChange={(e) => history.update({ model: e.target.value || undefined })}
        className={cls}
      />
      <input
        aria-label={t('observers.history.from')}
        type="datetime-local"
        value={toDatetimeLocal(history.filters.from)}
        onChange={(e) =>
          history.update({ from: e.target.value ? new Date(e.target.value).getTime() : undefined })
        }
        className={cls}
      />
      <input
        aria-label={t('observers.history.to')}
        type="datetime-local"
        value={toDatetimeLocal(history.filters.to)}
        onChange={(e) =>
          history.update({ to: e.target.value ? new Date(e.target.value).getTime() : undefined })
        }
        className={cls}
      />
    </div>
  );
}
