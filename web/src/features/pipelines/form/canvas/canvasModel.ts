import type { ConfigEditorResponse, FieldError } from '../../../../shared/api/types.ts';
import {
  ACTION_POINTS,
  pointsOfStages,
  type ActionPoint,
} from '../../../../shared/lib/pipeline/pipelineEntries.ts';
import type { PipelineStage } from '../../../../shared/lib/pipeline/pipelineStages.ts';
import { stepIds } from '../../stepIds.ts';
import { draftOf, record, stepOfError, type Draft } from '../steps/draft.ts';
import { pointNodeId, stepNodeId, type GraphContext } from '../steps/draftGraph.ts';
import { stepKeyOfNode } from '../steps/draftOps.ts';
import { stageOfKind } from '../steps/stageNodes.ts';

/** What the person chose on the canvas. */
export type Selection =
  | { kind: 'step'; key: number }
  | { kind: 'split' }
  | { kind: 'point'; point: ActionPoint }
  | { kind: 'return'; key: number }
  | { kind: 'follow' }
  | { kind: 'stage'; id: StageNodeId };

/** The nodes of the stages the system performs: shown only, described in the inspector. */
export type StageNodeId = 'merge' | 'delivery' | 'message' | 'resolver' | 'cleanup';
const STAGE_NODES: readonly StageNodeId[] = ['merge', 'delivery', 'message', 'resolver', 'cleanup'];

/** The selection a click on a node stands for. */
export function selectionOfNode(id: string): Selection | null {
  const key = stepKeyOfNode(id);
  if (key !== null) return { kind: 'step', key };
  if (id === 'split' || id === 'start') return { kind: 'split' };
  if (id.startsWith('follow:')) return { kind: 'follow' };
  const stage = STAGE_NODES.find((candidate) => candidate === id);
  if (stage) return { kind: 'stage', id: stage };
  const point = ACTION_POINTS.find((candidate) => pointNodeId(candidate) === id);
  return point ? { kind: 'point', point } : null;
}

/** The selection that is still there after the draft changed, or none. */
export function liveSelection(
  selection: Selection | null,
  draft: Draft,
  stages: readonly PipelineStage[] | null = null,
): Selection | null {
  if (!selection) return null;
  if (selection.kind === 'stage') {
    if (selection.id === 'delivery') return selection;
    if (selection.id === 'merge') return draft.split ? selection : null;
    return stageOfKind(stages, selection.id) ? selection : null;
  }
  if (selection.kind === 'step' || selection.kind === 'return') {
    const step = draft.steps.find((candidate) => candidate.key === selection.key);
    if (!step || draft.split?.pipeline) return null;
    return selection.kind === 'return' && step.gotoKey === null ? null : selection;
  }
  if (selection.kind === 'follow') return draft.split?.pipeline ? selection : null;
  if (selection.kind === 'point' && !draft.split && selection.point.endsWith('_split')) return null;
  return selection;
}

/** The id of the node a selection marks. */
export function selectedNodeId(selection: Selection | null): string | null {
  if (!selection) return null;
  if (selection.kind === 'step') return stepNodeId(selection.key);
  if (selection.kind === 'split') return 'split';
  if (selection.kind === 'point') return pointNodeId(selection.point);
  if (selection.kind === 'stage') return selection.id;
  return null;
}

/** The steps of the pipeline the groups follow, as the canvas shows them. */
export function followOf(view: ConfigEditorResponse, draft: Draft): GraphContext['follow'] {
  const pipeline = draft.split?.pipeline;
  if (!pipeline) return null;
  const target = view.pipelines.find((candidate) => candidate.id === pipeline);
  if (!target) return { pipeline, steps: null };
  const steps = draftOf(record(target.raw)).steps;
  const ids = stepIds(steps);
  return {
    pipeline,
    steps: steps
      .map((step, index) => ({
        id: ids[index] ?? '',
        specialist: step.specialist,
        gotoIndex: steps.findIndex((candidate) => candidate.key === step.gotoKey),
        maxRounds: step.maxRounds,
      }))
      .map((step) => ({ ...step, gotoIndex: step.gotoIndex < 0 ? null : step.gotoIndex })),
  };
}

/** The lists of the points: the own one, or the one the daemon computed; `null` while unknown. */
export function pointLists(
  draft: Draft,
  previewStages: readonly PipelineStage[] | null | undefined,
): GraphContext['points'] {
  const inherited = pointsOfStages(previewStages ?? undefined);
  return Object.fromEntries(
    ACTION_POINTS.map((point) => [
      point,
      draft.stages[point] ?? (previewStages === null ? null : inherited[point]),
    ]),
  ) as GraphContext['points'];
}

/** The errors that belong to a step (by index) of the draft. */
export function errorsOfStep(
  errors: FieldError[],
  pipelineId: string,
  draft: Draft,
  index: number,
): FieldError[] {
  return errors.filter(
    (error) => stepOfError(error.path, pipelineId, draft.split !== null).step === index,
  );
}
