import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../shared/lib/browser/cn.ts';
import { conditionText, performerText } from '../../../../shared/lib/pipeline/stageText.ts';
import type { CanvasNode as CanvasNodeType } from '../steps/draftGraph.ts';

/** The caption of a node by its kind. */
function useCaption(data: CanvasNodeType['data']): { title: string; subtitle: string } {
  const { t } = useTranslation();
  switch (data.kind) {
    case 'start':
      return { title: t('pipelines.canvasStart'), subtitle: '' };
    case 'merge':
      return { title: t('pipelines.canvasMerge'), subtitle: '' };
    case 'delivery':
      return { title: t('pipelines.canvasDelivery'), subtitle: '' };
    case 'message':
      return { title: t('pipelines.canvasMessage'), subtitle: '' };
    case 'resolver':
      return { title: t('pipelines.canvasResolver'), subtitle: '' };
    case 'cleanup':
      return { title: t('pipelines.canvasCleanup'), subtitle: '' };
    case 'split':
      return {
        title: t('pipelines.canvasSplit'),
        subtitle: data.title
          ? t('pipelines.canvasFollowStep', { pipeline: data.title })
          : data.subtitle,
      };
    case 'point':
      return {
        title: t(`pipeline.points.names.${data.point ?? 'before_split'}`),
        subtitle: data.count === null ? '…' : t('pipelines.canvasActions', { count: data.count }),
      };
    case 'follow':
      return {
        title: data.subtitle
          ? data.title
          : t('pipelines.canvasFollowMissing', { pipeline: data.title }),
        subtitle: data.subtitle,
      };
    default:
      return { title: data.title || t('pipelines.canvasNoSpecialist'), subtitle: data.subtitle };
  }
}

/** The lines under the caption: who performs a stage of the daemon and when it runs. */
function StageLines({ id, data }: { id: string; data: CanvasNodeType['data'] }) {
  const { t } = useTranslation();
  const condition = conditionText(data.condition, t);
  return (
    <>
      {data.performer ? (
        <div
          className="truncate text-xs text-muted-foreground"
          data-testid={`canvas-performer-${id}`}
        >
          {performerText(data.performer, t)}
        </div>
      ) : null}
      {condition !== null ? (
        <div className="truncate text-xs font-medium" data-testid={`canvas-condition-${id}`}>
          {condition}
        </div>
      ) : null}
    </>
  );
}

/** One node of the diagram: a step, the split, a point of actions or a stage of the system. */
export function CanvasNode({ id, data, selected, isConnectable }: NodeProps<CanvasNodeType>) {
  const { t } = useTranslation();
  const caption = useCaption(data);
  const step = data.kind === 'step' || data.kind === 'follow';
  return (
    <div
      data-testid={`canvas-node-${id}`}
      data-kind={data.kind}
      data-error={data.error ? 'true' : undefined}
      data-locked={data.locked ? 'true' : undefined}
      data-conditional={data.condition !== null ? 'true' : undefined}
      aria-invalid={data.error ? true : undefined}
      className={cn(
        'relative min-w-36 max-w-52 rounded-lg border px-3 py-2 text-sm shadow-sm',
        step ? 'bg-card' : 'bg-muted',
        selected && 'ring-2 ring-primary',
        data.error && 'border-destructive',
        data.locked && 'opacity-70',
        data.condition !== null && 'border-dashed',
      )}
    >
      {data.sectionStart && data.section ? (
        <div
          className="pointer-events-none absolute -top-5 left-0 text-[10px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase"
          data-testid={`canvas-section-${data.section}`}
        >
          {t(`topology.stages.section.${data.section}`)}
        </div>
      ) : null}
      <Handle type="target" position={Position.Left} id="in" isConnectable={false} />
      <div className="truncate font-medium">{caption.title}</div>
      {caption.subtitle ? (
        <div className="truncate text-xs text-muted-foreground">{caption.subtitle}</div>
      ) : null}
      <StageLines id={id} data={data} />
      <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
      {data.kind === 'delivery' ? (
        <Handle type="source" position={Position.Bottom} id="down" isConnectable={false} />
      ) : null}
      {data.kind === 'resolver' ? (
        <Handle type="target" position={Position.Top} id="up" isConnectable={false} />
      ) : null}
      {step ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="back-out"
            style={{ left: '35%' }}
            isConnectable={isConnectable}
          />
          <Handle
            type="target"
            position={Position.Bottom}
            id="back-in"
            style={{ left: '65%' }}
            isConnectable={isConnectable}
          />
        </>
      ) : null}
    </div>
  );
}
