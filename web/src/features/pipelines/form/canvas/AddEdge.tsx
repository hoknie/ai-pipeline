import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { edgeLook, pathOf } from '../../../../shared/lib/graph/OrthogonalEdge.tsx';
import type { CanvasEdge } from '../steps/draftGraph.ts';

/** Inserts a step at a place of the list; set by the canvas. */
export const AddStepContext = createContext<(index: number) => void>(() => {});

/** The edge between two stages with the button that inserts a step there. */
export function AddEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
  selected,
  selectable,
}: EdgeProps<CanvasEdge>) {
  const { t } = useTranslation();
  const route = data?.route;
  const path = pathOf(route, { x: sourceX, y: sourceY }, { x: targetX, y: targetY });
  const labelX = route?.label.x ?? (sourceX + targetX) / 2;
  const labelY = route?.label.y ?? (sourceY + targetY) / 2;
  const onAdd = useContext(AddStepContext);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        {...edgeLook(selected, selectable)}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          aria-label={t('pipelines.canvasAdd')}
          data-testid={`add-${id}`}
          className="nodrag nopan absolute flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onClick={() => onAdd(data?.index ?? 0)}
        >
          <Plus className="size-3" aria-hidden />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
