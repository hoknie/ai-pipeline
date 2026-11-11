import { POINT_SECTION } from '../../../../shared/lib/pipeline/pipelineEntries.ts';
import {
  stageLink,
  type PipelineStage,
  type StageSection,
} from '../../../../shared/lib/pipeline/pipelineStages.ts';
import type { CanvasKind, CanvasNode, CanvasNodeData } from './draftGraph.ts';

/** How far below the delivery the resolver stands. */
export const RESOLVER_OFFSET_Y = 130;

/** The stages of a canvas that the daemon, not the draft, decides on. */
export type SystemKind = 'message' | 'resolver' | 'cleanup';

const STAGE_KIND: Record<SystemKind, PipelineStage['kind']> = {
  message: 'message',
  resolver: 'resolve',
  cleanup: 'cleanup',
};

const DELIVERY_LINK = '#pipelines/system/delivery';

/** A node with every field of its data set; `data` overrides the defaults. */
export function canvasNode(id: string, x: number, data: Partial<CanvasNodeData>): CanvasNode {
  return {
    id,
    type: 'canvas',
    position: { x, y: 0 },
    draggable: false,
    connectable: false,
    data: {
      kind: 'step',
      title: '',
      subtitle: '',
      error: false,
      locked: false,
      key: null,
      point: null,
      count: null,
      performer: null,
      condition: null,
      section: null,
      sectionStart: false,
      link: null,
      ...data,
    },
  };
}

function sectionOf(data: CanvasNodeData): StageSection | null {
  switch (data.kind) {
    case 'start':
      return null;
    case 'point':
      return data.point ? POINT_SECTION[data.point] : null;
    case 'split':
      return 'prepare';
    case 'step':
    case 'follow':
      return 'work';
    case 'merge':
      return 'merge';
    case 'cleanup':
      return 'finish';
    default:
      return 'delivery';
  }
}

/** Gives each node its section and marks the first node of every section. */
export function withSections(nodes: CanvasNode[]): CanvasNode[] {
  let previous: StageSection | null = null;
  return nodes.map((item) => {
    const section = sectionOf(item.data);
    const sectionStart = item.data.kind !== 'resolver' && section !== null && section !== previous;
    if (item.data.kind !== 'resolver' && section !== null) previous = section;
    return { ...item, data: { ...item.data, section, sectionStart } };
  });
}

/** The stage of the daemon's list that a canvas kind stands for. */
export function stageOfKind(
  stages: readonly PipelineStage[] | null,
  kind: CanvasKind,
): PipelineStage | undefined {
  const wanted = kind in STAGE_KIND ? STAGE_KIND[kind as SystemKind] : kind;
  return stages?.find((stage) => stage.kind === wanted);
}

/**
 * The performer, condition and link of a stage: the daemon's. The merge and the delivery have a
 * system performer before the daemon answers.
 */
export function stageFields(
  stages: readonly PipelineStage[] | null,
  kind: 'merge' | 'delivery' | SystemKind,
): Pick<CanvasNodeData, 'performer' | 'condition' | 'link'> {
  const stage = stageOfKind(stages, kind);
  const builtin = kind === 'merge' || kind === 'delivery';
  return {
    performer: stage?.performer ?? (builtin ? { type: 'system' } : null),
    condition: stage?.condition ?? null,
    link: stage ? stageLink(stage) : kind === 'delivery' ? DELIVERY_LINK : null,
  };
}

/** The node of a stage the daemon lists; `null` when the list has no such stage. */
export function systemNode(
  stages: readonly PipelineStage[] | null,
  kind: SystemKind,
  x: number,
  y = 0,
): CanvasNode | null {
  const stage = stageOfKind(stages, kind);
  if (!stage) return null;
  const placed = canvasNode(kind, x, { kind, ...stageFields(stages, kind) });
  placed.position.y = y;
  return placed;
}
