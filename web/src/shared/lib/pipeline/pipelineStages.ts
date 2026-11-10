import type { PipelineStage, StagePerformer, PipelineTopology } from '../../api/types.ts';

export type { PipelineStage, StageKind, StagePerformer, StageSection } from '../../api/types.ts';

const SYSTEM: StagePerformer = { type: 'system' };

/**
 * The stages of a pipeline: the list from the engine, or, while the engine does not send one,
 * the list built from the older fields of the topology in the same order.
 */
export function pipelineStagesOf(pipeline: PipelineTopology): PipelineStage[] {
  if (pipeline.stages.length) return pipeline.stages;
  const stages: PipelineStage[] = [];
  const base = { condition: null, status: null, group: null };
  if (pipeline.split) {
    stages.push({
      ...base,
      id: 'split',
      kind: 'split',
      section: 'prepare',
      name: pipeline.split.specialist,
      performer: {
        type: 'specialist',
        slug: pipeline.split.specialist,
        name: pipeline.split.specialist,
      },
    });
  }
  for (const step of pipeline.steps) {
    stages.push({
      ...base,
      id: `step:${step.id}`,
      kind: 'step',
      section: 'work',
      name: step.name,
      performer: { type: 'specialist', slug: step.specialist, name: step.specialist },
    });
  }
  stages.push({
    ...base,
    id: 'merge',
    kind: 'merge',
    section: 'merge',
    name: 'merge',
    performer: SYSTEM,
  });
  stages.push({
    ...base,
    id: 'delivery',
    kind: 'delivery',
    section: 'delivery',
    name: 'delivery',
    performer: SYSTEM,
  });
  const resolver = pipeline.delivery.resolver;
  if (resolver) {
    stages.push({
      ...base,
      id: 'resolve',
      kind: 'resolve',
      section: 'delivery',
      name: 'resolve',
      condition: 'conflict',
      performer: { type: 'specialist', slug: resolver, name: resolver },
    });
  }
  return stages;
}

/** Id of the graph node of a stage; the resolver node keeps its older id `resolver`. */
export function stageNodeId(stage: PipelineStage): string {
  return stage.kind === 'resolve' ? 'resolver' : stage.id;
}

/** Id of an action in the id of its stage: `action:<point>:<id>`. */
function actionId(stage: PipelineStage): string {
  return stage.id.split(':').slice(2).join(':');
}

/** Address of the entry of a stage in the Pipeline tab; null for stages without an entry. */
export function stageLink(stage: PipelineStage): string | null {
  switch (stage.kind) {
    case 'action':
      return `#pipelines/actions/${encodeURIComponent(actionId(stage))}`;
    case 'split':
    case 'message':
    case 'delivery':
    case 'resolve':
      return `#pipelines/system/${stage.kind}`;
    default:
      return null;
  }
}
