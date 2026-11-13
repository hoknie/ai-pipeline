import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { RepositoryView, RunView, StatsReportView } from '../../shared/api/types.ts';
import type { StatsPeriodId } from '../../shared/lib/nav/route.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Empty } from '../../shared/ui/feedback/empty.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { BreakdownTabs } from './BreakdownTabs.tsx';
import { DailyChart } from './DailyChart.tsx';
import { KpiTiles } from './KpiTiles.tsx';
import { ProjectShares } from './ProjectShares.tsx';
import { ProjectsTable } from './ProjectsTable.tsx';
import { StatsFilters } from './StatsFilters.tsx';
import { isEmpty } from './statsView.ts';
import { useStatsReport } from './useStatsReport.ts';

function Content({
  api,
  report,
  onProject,
  onCleared,
}: {
  api: Api;
  report: StatsReportView;
  onProject: (repository: string) => void;
  onCleared: () => void;
}) {
  const { t } = useTranslation();
  if (isEmpty(report)) {
    return (
      <Empty icon={<BarChart3 />} title={t('stats.empty.title')}>
        <p>{t('stats.empty.hint')}</p>
      </Empty>
    );
  }
  return (
    <>
      <KpiTiles report={report} />
      <DailyChart report={report} />
      <ProjectShares report={report} />
      <ProjectsTable api={api} report={report} onSelect={onProject} onCleared={onCleared} />
      <BreakdownTabs report={report} />
    </>
  );
}

/** The page «Statistics»: filters of the period and the project, then what the report holds. */
export default function StatsPage({
  api,
  registry,
  runs,
  period,
  project,
  onFilter,
}: {
  api: Api;
  registry: readonly RepositoryView[];
  runs: readonly RunView[];
  period: StatsPeriodId;
  project: string | null;
  onFilter: (period: StatsPeriodId, project: string | null) => void;
}) {
  const { t } = useTranslation();
  const { report, error, loading, reload } = useStatsReport(api, period, project, runs);
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4" data-testid="stats-page">
      <StatsFilters period={period} project={project} registry={registry} onChange={onFilter} />
      {report !== null && !report.settings.enabled ? (
        <Alert variant="warn" className="flex flex-wrap items-center gap-2">
          <span>{t('stats.disabled.title')}</span>
          <a href="#settings/global/system" className="underline underline-offset-2">
            {t('stats.disabled.open')}
          </a>
        </Alert>
      ) : null}
      {error !== null ? (
        <Alert variant="destructive" className="flex flex-wrap items-center gap-2">
          <span>{t('stats.error', { message: error })}</span>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            {t('stats.retry')}
          </Button>
        </Alert>
      ) : null}
      {report === null && loading ? (
        <div role="status" aria-label={t('stats.loading')} className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {report === null ? null : (
        <Content
          api={api}
          report={report}
          onProject={(repository) => onFilter(period, repository)}
          onCleared={reload}
        />
      )}
    </div>
  );
}
