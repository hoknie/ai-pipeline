import type { Edge, Node } from '@xyflow/react';

import type { FieldError } from '../../../../shared/api/types.ts';
import type { ActionPoint } from '../../../../shared/lib/pipeline/pipelineEntries.ts';
import type {
  PipelineStage,
  StageCondition,
  StagePerformer,
  StageSection,
} from '../../../../shared/lib/pipeline/pipelineStages.ts';
import { stepOfError, type Draft } from './draft.ts';
import { STEP_NODE_PREFIX } from './draftOps.ts';
import {
  RESOLVER_OFFSET_Y,
  canvasNode as node,
  stageFields,
  systemNode,
  withSections,
} from './stageNodes.ts';

export const GAP_X = 240;
export const CONFLICT_EDGE = 'conflict:delivery->resolver';

export type CanvasKind =
  | 'start'
  | 'point'
  | 'split'
  | 'step'
  | 'follow'
  | 'merge'
  | 'delivery'
  | 'message'
  | 'resolver'
  | 'cleanup';

export interface CanvasNodeData extends Record<string, unknown> {
  kind: CanvasKind;
  /** The id of a step, the target pipeline of a split that follows another one. */
  title: string;
  /** The specialist of a step or of the split. */
  subtitle: string;
  error: boolean;
  /** The node is shown only: the step belongs to another pipeline. */
  locked: boolean;
  /** The key of a step node. */
  key: number | null;
  point: ActionPoint | null;
  /** The number of actions of a point; `null` while the inherited list is unknown. */
  count: number | null;
  /** Who performs a stage the daemon lists (merge, delivery, message, resolver, cleanup). */
  performer: StagePerformer | null;
  /** Why the stage does not always run. */
  condition: StageCondition | null;
  section: StageSection | null;
  /** The node is the first of its section and carries the caption of the section. */
  sectionStart: boolean;
  /** The address of the entry of the stage in the Pipeline tab. */
  link: string | null;
}

export type CanvasNode = Node<CanvasNodeData, 'canvas'>;

export interface AddEdgeData extends Record<string, unknown> {
  /** The place in the list of steps where a click on the plus inserts one. */
  index: number;
}

export type CanvasEdge = Edge<AddEdgeData>;

export interface FollowStep {
  id: string;
  specialist: string;
  gotoIndex: number | null;
  maxRounds: string;
}

export interface GraphContext {
  pipelineId: string;
  /** The ids the steps get on save. */
  ids: string[];
  /** The steps the groups follow when the split names another pipeline; `steps` null: not found. */
  follow: { pipeline: string; steps: FollowStep[] | null } | null;
  /** The lists of the points, own or inherited; `null` while unknown. */
  points: Record<ActionPoint, string[] | null>;
  /** The stages of the last answer of the daemon to the check of the draft; `null`: none yet. */
  stages: readonly PipelineStage[] | null;
  errors: FieldError[];
  /** Whether steps can be added, moved and linked. */
  editable: boolean;
}

export const stepNodeId = (key: number): string => `${STEP_NODE_PREFIX}${key}`;
export const pointNodeId = (point: ActionPoint): string => `point:${point}`;

/** The ids of the nodes marked by the errors: a step of the draft or the split. */
function markedNodes(draft: Draft, context: GraphContext): Set<string> {
  const marked = new Set<string>();
  for (const error of context.errors) {
    const place = stepOfError(error.path, context.pipelineId, draft.split !== null);
    if (place.split) marked.add('split');
    const step = place.step === null || draft.split?.pipeline ? undefined : draft.steps[place.step];
    if (step) marked.add(stepNodeId(step.key));
  }
  return marked;
}

function pointNode(point: ActionPoint, x: number, context: GraphContext): CanvasNode {
  return node(pointNodeId(point), x, {
    kind: 'point',
    point,
    count: context.points[point]?.length ?? null,
  });
}

function followNodes(context: GraphContext, start: number) {
  const follow = context.follow as NonNullable<GraphContext['follow']>;
  if (follow.steps === null) {
    return [
      node('follow:0', start, {
        kind: 'follow',
        title: follow.pipeline,
        error: true,
        locked: true,
      }),
    ];
  }
  return follow.steps.map((step, index) =>
    node(`follow:${index}`, start + index * GAP_X, {
      kind: 'follow',
      title: step.id,
      subtitle: step.specialist,
      locked: true,
    }),
  );
}

/** The nodes in the order of the stages: start, points, split, steps, merge, delivery, cleanup. */
function chainOf(draft: Draft, context: GraphContext, marked: Set<string>): CanvasNode[] {
  const nodes: CanvasNode[] = [node('start', 0, { kind: 'start' })];
  const add = (item: (x: number) => CanvasNode) => nodes.push(item(nodes.length * GAP_X));
  const hasSplit = draft.split !== null;
  if (hasSplit) {
    add((x) => pointNode('before_split', x, context));
    add((x) =>
      node('split', x, {
        kind: 'split',
        subtitle: draft.split?.specialist ?? '',
        title: draft.split?.pipeline ?? '',
        error: marked.has('split'),
      }),
    );
    add((x) => pointNode('after_split', x, context));
  }
  if (context.follow && hasSplit) {
    nodes.push(...followNodes(context, nodes.length * GAP_X));
  } else {
    for (const [index, step] of draft.steps.entries()) {
      add((x) =>
        node(stepNodeId(step.key), x, {
          kind: 'step',
          key: step.key,
          title: context.ids[index] ?? '',
          subtitle: step.specialist,
          error: marked.has(stepNodeId(step.key)),
        }),
      );
      const last = nodes[nodes.length - 1] as CanvasNode;
      last.draggable = context.editable;
      last.connectable = context.editable;
    }
  }
  if (hasSplit)
    add((x) => node('merge', x, { kind: 'merge', ...stageFields(context.stages, 'merge') }));
  add((x) => pointNode('before_delivery', x, context));
  const message = systemNode(context.stages, 'message', nodes.length * GAP_X);
  if (message) nodes.push(message);
  add((x) => node('delivery', x, { kind: 'delivery', ...stageFields(context.stages, 'delivery') }));
  add((x) => pointNode('after_delivery', x, context));
  const cleanup = systemNode(context.stages, 'cleanup', nodes.length * GAP_X);
  if (cleanup) nodes.push(cleanup);
  return nodes;
}

function orderEdges(nodes: CanvasNode[], draft: Draft, context: GraphContext): CanvasEdge[] {
  const withAdd = context.editable && !(context.follow && draft.split);
  const keyed = (item: CanvasNode) => draft.steps.findIndex((step) => step.key === item.data.key);
  const beforeSteps = draft.split ? pointNodeId('after_split') : 'start';
  const edges: CanvasEdge[] = [];
  for (let at = 1; at < nodes.length; at++) {
    const from = nodes[at - 1] as CanvasNode;
    const to = nodes[at] as CanvasNode;
    // a plus sits where a step may be inserted: before a step, and after the last one
    let insertAt: number | null = null;
    if (to.data.kind === 'step') insertAt = keyed(to);
    else if (from.data.kind === 'step') insertAt = draft.steps.length;
    else if (draft.steps.length === 0 && from.id === beforeSteps) insertAt = 0;
    edges.push({
      id: `next:${from.id}->${to.id}`,
      source: from.id,
      target: to.id,
      type: withAdd && insertAt !== null ? 'add' : 'default',
      selectable: false,
      data: { index: insertAt ?? 0 },
    });
  }
  return edges;
}

/** The edge from the delivery down to the resolver; the canvas gives it its caption. */
function conflictEdge(): CanvasEdge {
  return {
    id: CONFLICT_EDGE,
    source: 'delivery',
    target: 'resolver',
    sourceHandle: 'down',
    targetHandle: 'up',
    selectable: false,
    data: { index: 0 },
  };
}

function returnEdges(draft: Draft, context: GraphContext): CanvasEdge[] {
  if (context.follow && draft.split) {
    return (context.follow.steps ?? []).flatMap((step, index) =>
      step.gotoIndex === null
        ? []
        : [
            {
              id: `return:follow:${index}`,
              source: `follow:${index}`,
              target: `follow:${step.gotoIndex}`,
              sourceHandle: 'back-out',
              targetHandle: 'back-in',
              selectable: false,
              ...(step.maxRounds ? { label: `≤ ${step.maxRounds}` } : {}),
              data: { index: 0 },
            },
          ],
    );
  }
  return draft.steps.flatMap((step) => {
    const target = draft.steps.find((candidate) => candidate.key === step.gotoKey);
    if (!target) return [];
    return [
      {
        id: `return:${step.key}`,
        source: stepNodeId(step.key),
        target: stepNodeId(target.key),
        sourceHandle: 'back-out',
        targetHandle: 'back-in',
        ...(step.maxRounds.trim() ? { label: `≤ ${step.maxRounds.trim()}` } : {}),
        data: { index: 0 },
      },
    ];
  });
}

/** The nodes and edges of the canvas for a draft. */
export function draftGraph(
  draft: Draft,
  context: GraphContext,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const marked = markedNodes(draft, context);
  const chain = withSections(chainOf(draft, context, marked));
  const delivery = chain.find((item) => item.id === 'delivery') as CanvasNode;
  const resolver = systemNode(context.stages, 'resolver', delivery.position.x, RESOLVER_OFFSET_Y);
  return {
    nodes: resolver ? [...chain, ...withSections([resolver])] : chain,
    edges: [
      ...orderEdges(chain, draft, context),
      ...(resolver ? [conflictEdge()] : []),
      ...returnEdges(draft, context),
    ],
  };
}
