import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../shared/lib/browser/cn.ts';
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

/** One node of the diagram: a step, the split, a point of actions or a fixed stage. */
export function CanvasNode({ id, data, selected, isConnectable }: NodeProps<CanvasNodeType>) {
  const caption = useCaption(data);
  const step = data.kind === 'step' || data.kind === 'follow';
  return (
    <div
      data-testid={`canvas-node-${id}`}
      data-kind={data.kind}
      data-error={data.error ? 'true' : undefined}
      data-locked={data.locked ? 'true' : undefined}
      aria-invalid={data.error ? true : undefined}
      className={cn(
        'min-w-36 max-w-52 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm',
        selected && 'ring-2 ring-primary',
        data.error && 'border-destructive',
        data.locked && 'opacity-70',
        !step && 'border-dashed',
      )}
    >
      <Handle type="target" position={Position.Left} id="in" isConnectable={false} />
      <div className="truncate font-medium">{caption.title}</div>
      {caption.subtitle ? (
        <div className="truncate text-xs text-muted-foreground">{caption.subtitle}</div>
      ) : null}
      <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
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
