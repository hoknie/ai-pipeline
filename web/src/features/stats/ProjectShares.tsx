import { useTranslation } from 'react-i18next';

import type { StatsReportView } from '../../shared/api/types.ts';
import { repositoryColor, repositoryLabel } from '../../shared/lib/catalog/repositories.ts';
import { ShareBars, StackBar } from '../../shared/ui/charts/index.ts';
import { assignColors, OUTCOME_COLORS } from '../../shared/ui/charts/palette.ts';
import { Card } from '../../shared/ui/layout/card.tsx';
import { compactNumber, durationText, projectShares } from './statsView.ts';

const OUTCOMES = ['finished', 'failed', 'cancelled'] as const;

/** The shares of the projects (all projects only) and the outcomes of the tasks. */
export function ProjectShares({ report }: { report: StatsReportView }) {
  const { t } = useTranslation();
  const all = report.repository === null;
  const colors = assignColors(
    report.projects.map((row) => row.repository),
    repositoryColor,
  );
  const rowsOf = (metric: 'tokens' | 'agent') =>
    projectShares(report, metric).map((row) => ({
      key: row.repository,
      label: repositoryLabel(row.repository),
      color: colors[row.repository] ?? '',
      value: row.value,
      text: metric === 'tokens' ? compactNumber(row.value) : durationText(row.value, t),
    }));
  return (
    <div className={`grid gap-3 ${all ? 'xl:grid-cols-3' : ''}`}>
      {all ? (
        <>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">{t('stats.shares.tokens')}</h2>
            <ShareBars
              label={t('stats.shares.tokens')}
              rows={rowsOf('tokens')}
              nameHead={t('stats.projects.project')}
              valueHead={t('stats.tiles.tokens')}
            />
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">{t('stats.shares.agent')}</h2>
            <ShareBars
              label={t('stats.shares.agent')}
              rows={rowsOf('agent')}
              nameHead={t('stats.projects.project')}
              valueHead={t('stats.tiles.agent')}
            />
          </Card>
        </>
      ) : null}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">{t('stats.shares.outcomes')}</h2>
        <StackBar
          label={t('stats.shares.outcomes')}
          nameHead={t('stats.shares.outcome')}
          valueHead={t('stats.tiles.tasks')}
          segments={OUTCOMES.map((id) => ({
            key: id,
            label: t(`stats.shares.outcomeNames.${id}`),
            color: OUTCOME_COLORS[id],
            value: report.outcomes[id],
          }))}
        />
      </Card>
    </div>
  );
}
