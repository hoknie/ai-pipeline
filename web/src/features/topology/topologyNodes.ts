import type { TFunction } from 'i18next';

import type { LoadEntry, MachineLoad } from '../../shared/lib/pipeline/specialistLoad.ts';
import {
  stageLink,
  stageNodeId,
  type PipelineStage,
  type StageSection,
} from '../../shared/lib/pipeline/pipelineStages.ts';
import { conditionText, performerText } from '../../shared/lib/pipeline/stageText.ts';
import type { PipelineTopology } from '../../shared/api/types.ts';
import type { Live, LiveGroup } from './liveState.ts';
import type { Busy, Size, StageData } from './topologyTypes.ts';

/** Height assumed for a node that has not been measured yet. */
export const FALLBACK_HEIGHT = 90;
/** Width of a stage card, assumed for a node that has not been measured yet. */
export const FALLBACK_WIDTH = 170;
/** Vertical gap between the delivery and the resolver. */
export const RESOLVER_GAP = 60;

/** What building a node needs to know about the pipeline and the runs on it. */
export interface NodeContext {
  pipeline: PipelineTopology;
  live: Live;
  load: MachineLoad;
  t: TFunction;
  sizes: ReadonlyMap<string, Size>;
}

/** A node before it is placed: its id and data. */
export interface NodeSpec {
  id: string;
  data: StageData;
}

/** Entries of other runs that run on, or wait for, the specialist. */
export function otherUse(
  load: MachineLoad,
  live: Live,
  specialist: string,
): { running: LoadEntry[]; waiting: LoadEntry[] } {
  const own = new Set(live.runIds);
  const slug = load.get(specialist);
  return {
    running: (slug?.running ?? []).filter((entry) => !own.has(entry.runId)),
    waiting: (slug?.waiting ?? []).filter((entry) => !own.has(entry.runId)),
  };
}

function busyOf(
  pipeline: PipelineTopology,
  live: Live,
  load: MachineLoad,
  specialist: string,
): Busy {
  const slug = load.get(specialist);
  const limits = [slug?.max ?? null, pipeline.limits?.[specialist] ?? null].filter(
    (limit): limit is number => limit !== null && limit > 0,
  );
  const max = limits.length > 0 ? Math.min(...limits) : null;
  const running = slug?.running.length ?? 0;
  return {
    running,
    elsewhere: otherUse(load, live, specialist).running.length,
    max,
    full: max !== null && running >= max,
  };
}

function active(groups: LiveGroup[]): boolean {
  return groups.some((group) => group.status === 'running' || group.status === 'merging');
}

const EMPTY = {
  attempts: null,
  costUsd: null,
  inputTokens: null,
  outputTokens: null,
  step: null,
  specialist: null,
  busy: null,
};

type Common = Pick<
  StageData,
  'stageId' | 'section' | 'sectionStart' | 'performer' | 'condition' | 'link'
>;

/** The fields every node of a stage shares. */
export function commonOf(
  stage: PipelineStage,
  previous: StageSection | null,
  t: TFunction,
): Common {
  return {
    stageId: stage.id,
    section: stage.section,
    sectionStart: stage.section !== previous,
    performer: performerText(stage.performer, t),
    condition: conditionText(stage.condition, t),
    link: stageLink(stage),
  };
}

function splitNode({ pipeline, live, load, t }: NodeContext, common: Common): NodeSpec | null {
  const split = pipeline.split;
  if (!split) return null;
  const splitStage = pipeline.stages.find((stage) => stage.id === 'split');
  const splitName =
    splitStage?.performer.type === 'specialist' && splitStage.performer.name
      ? splitStage.performer.name
      : split.specialist;
  const pipelineText = split.pipeline
    ? [t('topology.splitPipeline', { id: split.pipelineName ?? split.pipeline })]
    : [];
  return {
    id: 'split',
    data: {
      kind: 'split',
      title: t('topology.split'),
      subtitle: splitName,
      ...(splitName === split.specialist ? {} : { subtitleHint: split.specialist }),
      detail: [t('topology.splitDetail', { n: split.maxGroups }), ...pipelineText].join(' · '),
      groups: live.splitting,
      active: live.splitting.some((group) => group.status === 'running'),
      ...EMPTY,
      ...common,
      specialist: split.specialist,
      busy: busyOf(pipeline, live, load, split.specialist),
    },
  };
}

function stepNode(ctx: NodeContext, stage: PipelineStage, common: Common): NodeSpec | null {
  const { pipeline, live, load } = ctx;
  const step = pipeline.steps.find((candidate) => `step:${candidate.id}` === stage.id);
  if (!step) return null;
  const groups = live.steps.get(step.id) ?? [];
  return {
    id: `step:${step.id}`,
    data: {
      kind: 'step',
      title: step.name,
      subtitle: step.specialist,
      detail: `${step.runtime}${step.model ? ` ${step.model}` : ''} · ${step.permissions}`,
      groups,
      attempts: live.attempts.get(step.id) ?? 0,
      costUsd: live.cost.get(step.id) ?? null,
      inputTokens: live.inputTokens.get(step.id) ?? 0,
      outputTokens: live.outputTokens.get(step.id) ?? 0,
      active: active(groups),
      step: step.id,
      specialist: step.specialist,
      busy: busyOf(pipeline, live, load, step.specialist),
      ...common,
    },
  };
}

function otherNode(ctx: NodeContext, stage: PipelineStage, common: Common): NodeSpec {
  const { pipeline, live, load, t } = ctx;
  const slug = stage.performer.type === 'specialist' ? stage.performer.slug : null;
  const kind = stage.kind === 'action' || stage.kind === 'message' ? stage.kind : 'cleanup';
  const title =
    stage.kind === 'message'
      ? t('topology.stages.name.message')
      : stage.kind === 'cleanup'
        ? t('topology.stages.name.cleanup')
        : stage.name;
  return {
    id: stageNodeId(stage),
    data: {
      kind,
      title,
      subtitle: performerText(stage.performer, t),
      detail: null,
      groups: [],
      active: false,
      ...EMPTY,
      ...common,
      specialist: slug,
      busy: slug ? busyOf(pipeline, live, load, slug) : null,
    },
  };
}

/** The node of a stage on the main line; `null` when the pipeline has no such part. */
export function mainNode(ctx: NodeContext, stage: PipelineStage, common: Common): NodeSpec | null {
  const { t, live, pipeline } = ctx;
  switch (stage.kind) {
    case 'split':
      return splitNode(ctx, common);
    case 'step':
      return stepNode(ctx, stage, common);
    case 'merge':
      return {
        id: 'merge',
        data: {
          kind: 'merge',
          title: t('topology.merge'),
          subtitle: t('topology.mergeSubtitle'),
          detail: null,
          groups: live.merging,
          active: active(live.merging),
          ...EMPTY,
          ...common,
        },
      };
    case 'delivery':
      return {
        id: 'delivery',
        data: {
          kind: 'delivery',
          title: t('topology.deliveryNode'),
          subtitle: pipeline.delivery.mode,
          detail: null,
          groups: live.merged,
          active: false,
          ...EMPTY,
          ...common,
        },
      };
    default:
      return otherNode(ctx, stage, common);
  }
}

/** The resolver under the delivery: its node and the edge to it. */
export function resolverNode(
  ctx: NodeContext,
  stage: PipelineStage,
  common: Common,
  delivery: { position: { x: number } } | undefined,
): (NodeSpec & { position: { x: number; y: number } }) | null {
  const { pipeline, live, load, t, sizes } = ctx;
  const slug = stage.performer.type === 'specialist' ? stage.performer.slug : null;
  const resolver = pipeline.delivery.resolver ?? slug;
  if (!resolver || !delivery) return null;
  const height = (id: string) => sizes.get(id)?.height ?? FALLBACK_HEIGHT;
  return {
    id: 'resolver',
    position: {
      x: delivery.position.x,
      y: height('delivery') / 2 + RESOLVER_GAP + height('resolver') / 2,
    },
    data: {
      kind: 'resolver',
      title: t('topology.resolver'),
      subtitle: resolver,
      detail: null,
      groups: [],
      active: false,
      ...EMPTY,
      ...common,
      sectionStart: false,
      specialist: resolver,
      busy: busyOf(pipeline, live, load, resolver),
    },
  };
}
