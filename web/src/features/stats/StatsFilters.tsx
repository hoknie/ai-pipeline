import { useTranslation } from 'react-i18next';

import type { RepositoryView } from '../../shared/api/types.ts';
import { directoryLabel } from '../../shared/lib/catalog/repositories.ts';
import { STATS_PERIODS, type StatsPeriodId } from '../../shared/lib/nav/route.ts';
import { ToggleGroup, ToggleGroupItem } from '../../shared/ui/forms/toggle-group.tsx';

const PERIOD_ORDER: StatsPeriodId[] = ['7d', '30d', '90d', 'all'];

/** The period and the project of the page; the choice lives in the address. */
export function StatsFilters({
  period,
  project,
  registry,
  onChange,
}: {
  period: StatsPeriodId;
  project: string | null;
  registry: readonly RepositoryView[];
  onChange: (period: StatsPeriodId, project: string | null) => void;
}) {
  const { t } = useTranslation();
  const known = registry.some((entry) => entry.path === project);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        type="single"
        value={period}
        aria-label={t('stats.filters.period')}
        onValueChange={(next) => {
          const chosen = STATS_PERIODS.find((candidate) => candidate === next);
          if (chosen !== undefined) onChange(chosen, project);
        }}
      >
        {PERIOD_ORDER.map((id) => (
          <ToggleGroupItem key={id} value={id}>
            {t(`stats.filters.periods.${id}` as never)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('stats.filters.project')}</span>
        <select
          className="h-8 max-w-64 rounded-md border border-input bg-card px-2 text-sm"
          value={project ?? ''}
          onChange={(event) =>
            onChange(period, event.target.value === '' ? null : event.target.value)
          }
        >
          <option value="">{t('stats.filters.allProjects')}</option>
          {project !== null && !known ? (
            <option value={project}>{directoryLabel(project)}</option>
          ) : null}
          {registry.map((entry) => (
            <option key={entry.path} value={entry.path}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
