import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { StatsReportView } from '../../shared/api/types.ts';
import { Card } from '../../shared/ui/layout/card.tsx';
import { compactNumber, durationText } from './statsView.ts';

function Tile({
  label,
  value,
  title,
  children,
}: {
  label: string;
  value: string;
  /** The exact value, shown as a tip. */
  title?: string;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-1 p-3" data-testid="kpi-tile">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums" title={title}>
        {value}
      </span>
      {children ? <span className="text-xs text-muted-foreground">{children}</span> : null}
    </Card>
  );
}

/** The totals of the period, and the averages per task with their medians. */
export function KpiTiles({ report }: { report: StatsReportView }) {
  const { t, i18n } = useTranslation();
  const { totals, perTask, outcomes } = report;
  const exact = (value: number) => value.toLocaleString(i18n.language);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile
          label={t('stats.tiles.tokens')}
          value={compactNumber(totals.tokens)}
          title={exact(totals.tokens)}
        >
          {t('stats.tiles.tokensSplit', {
            input: compactNumber(totals.inputTokens),
            output: compactNumber(totals.outputTokens),
          })}
        </Tile>
        <Tile label={t('stats.tiles.agent')} value={durationText(totals.agentMs, t)} />
        <Tile label={t('stats.tiles.tasks')} value={String(totals.tasks)}>
          {t('stats.tiles.outcomes', outcomes)}
        </Tile>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Tile
          label={t('stats.tiles.perTaskTokens')}
          value={compactNumber(perTask.tokens.mean)}
          title={exact(Math.round(perTask.tokens.mean))}
        >
          {t('stats.tiles.median', { value: compactNumber(perTask.tokens.median) })}
        </Tile>
        <Tile label={t('stats.tiles.perTaskAgent')} value={durationText(perTask.agentMs.mean, t)}>
          {t('stats.tiles.median', { value: durationText(perTask.agentMs.median, t) })}
        </Tile>
      </div>
    </div>
  );
}
