import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../shared/lib/browser/cn.ts';
import { cost, usageText } from '../../shared/lib/format.ts';
import { StatusBadge } from '../../shared/ui/feedback/StatusBadge.tsx';
import { Card } from '../../shared/ui/layout/card.tsx';
import type { StageData, StageNode } from './topologyLayout.ts';

/** The six connection points of a node. */
function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="target" position={Position.Bottom} id="back-in" />
      <Handle type="source" position={Position.Bottom} id="back-out" />
      <Handle type="source" position={Position.Bottom} id="down" />
      <Handle type="target" position={Position.Top} id="up" />
    </>
  );
}

/** The lines under the title: who performs the stage, its condition and detail, the groups. */
function StageLines({ data, testId }: { data: StageData; testId: string }) {
  return (
    <>
      <div className="truncate text-muted-foreground" title={data.subtitle}>
        {data.subtitle}
      </div>
      {data.performer && data.performer !== data.subtitle ? (
        <div
          className="truncate text-muted-foreground"
          data-testid={`performer-${testId}`}
          title={data.performer}
        >
          {data.performer}
        </div>
      ) : null}
      {data.condition !== null ? (
        <div className="truncate font-medium" data-testid={`condition-${testId}`}>
          {data.condition}
        </div>
      ) : null}
      {data.detail ? <div className="truncate text-muted-foreground">{data.detail}</div> : null}
      {data.groups.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1">
          {data.groups.map((group) => (
            <StatusBadge
              key={`${group.runId}/${group.slug}`}
              status={group.status}
              label={group.title}
              title={group.title}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

/** How busy the specialist is, and the attempts and usage of a step. */
function StageLoad({ data, testId }: { data: StageData; testId: string }) {
  const { t } = useTranslation();
  const usageLine =
    [
      usageText({ inputTokens: data.inputTokens ?? 0, outputTokens: data.outputTokens ?? 0 }),
      cost({ costUsd: data.costUsd }),
    ]
      .filter(Boolean)
      .join(' · ') || '—';
  return (
    <>
      {data.busy && (data.busy.running > 0 || data.busy.max !== null) ? (
        <div
          className={cn('truncate text-muted-foreground', data.busy.full && 'font-medium')}
          data-testid={`busy-${testId}`}
        >
          {data.busy.max === null
            ? t('topology.busyUnlimited', { n: data.busy.running })
            : t('topology.busy', { n: data.busy.running, max: data.busy.max })}
          {data.busy.elsewhere > 0
            ? ` · ${t('topology.busyElsewhere', { n: data.busy.elsewhere })}`
            : ''}
        </div>
      ) : null}
      {data.attempts !== null ? (
        <>
          <div className="truncate text-muted-foreground">
            {t('topology.attempts', { n: data.attempts })}
          </div>
          <div
            className="truncate text-muted-foreground tabular-nums"
            data-testid={`usage-${data.step}`}
            title={usageLine}
          >
            {usageLine}
          </div>
        </>
      ) : null}
    </>
  );
}

/** The node of the pipeline graph. */
export function Stage({ data, selected }: NodeProps<StageNode>) {
  const { t } = useTranslation();
  const testId = data.step ?? (data.kind === 'action' ? data.stageId : data.kind);
  return (
    <Card
      className={cn(
        'relative grid w-[170px] grid-cols-[minmax(0,1fr)] gap-1 px-3 py-2.5 text-xs',
        data.kind !== 'step' && 'bg-muted',
        data.condition !== null && 'border-dashed',
        data.active && 'border-status-run ring-4 ring-status-run-bg',
        data.busy?.full && 'border-status-warn bg-status-warn-bg',
        selected && 'border-primary',
      )}
      data-testid={`stage-${testId}`}
      data-conditional={data.condition !== null ? 'true' : undefined}
    >
      {data.sectionStart ? (
        <div
          className="pointer-events-none absolute -top-5 left-0 text-[10px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase"
          data-testid={`section-${data.section}`}
        >
          {t(`topology.stages.section.${data.section}`)}
        </div>
      ) : null}
      <Handles />
      <div className="truncate text-sm font-bold" title={data.title}>
        {data.title}
      </div>
      <StageLines data={data} testId={testId} />
      <StageLoad data={data} testId={testId} />
    </Card>
  );
}
