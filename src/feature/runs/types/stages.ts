import {
  type Action,
  type ActionPoint,
  type Pipeline,
  type ResolvedConfig,
  findAction,
  groupPipeline,
  pipelineActionIds,
  scriptText,
} from '../../swarm-config/types/index.ts';
import { MESSAGE_GROUP, RESOLVE_GROUP, SPLIT_GROUP } from './constants.ts';
import { actionSlug } from './group.ts';
import { type RunState, actionGroupsOf, runPipeline } from './run.ts';
import {
  type StageStatus,
  actionName,
  actionStatus,
  cleanupStatus,
  deliveryStatus,
  mergeStatus,
  statusOf,
  stepStatus,
} from './stage-status.ts';
import { specialistName, stepLabel } from './topology.ts';

export type StageSection = 'prepare' | 'work' | 'merge' | 'delivery' | 'finish';

export type StageKind =
  'action' | 'split' | 'step' | 'merge' | 'message' | 'delivery' | 'resolve' | 'cleanup';

export type StagePerformer =
  | { type: 'specialist'; slug: string; name: string }
  | { type: 'command'; command: string }
  | { type: 'system' };

/** Keys of the conditions under which a stage runs. */
export type StageCondition = 'delivery_commit' | 'conflict' | 'not_keep';

export interface PipelineStage {
  /** `split`, `step:<id>`, `action:<point>:<id>`, `merge`, `message`, `delivery`, `resolve`, `cleanup`. */
  id: string;
  kind: StageKind;
  section: StageSection;
  name: string;
  performer: StagePerformer;
  /** Why the stage does not always run; null: it always runs. */
  condition: StageCondition | null;
  /** Null on the graph of a pipeline outside a run, and for a stage the run has not reached. */
  status: StageStatus | null;
  /** Slug of the service group that runs the stage. */
  group: string | null;
}

const POINT_SECTION: Record<ActionPoint, StageSection> = {
  before_split: 'prepare',
  after_split: 'prepare',
  before_delivery: 'delivery',
  after_delivery: 'finish',
};

function performerOf(config: ResolvedConfig, action: Action): StagePerformer {
  if (action.run !== null) return { type: 'command', command: scriptText(action.run) };
  const slug = action.specialist ?? '';
  return { type: 'specialist', slug, name: specialistName(config, slug) };
}

const SYSTEM: StagePerformer = { type: 'system' };

function specialistPerformer(config: ResolvedConfig, slug: string): StagePerformer {
  return { type: 'specialist', slug, name: specialistName(config, slug) };
}

/** The stages of the actions of one point, in the order of its list. */
function actionStages(
  config: ResolvedConfig,
  pipeline: Pipeline,
  point: ActionPoint,
  state?: RunState,
): PipelineStage[] {
  const stages: PipelineStage[] = [];
  for (const id of pipelineActionIds(config, pipeline, point)) {
    const action = findAction(config, id);
    if (!action) continue;
    const slug = actionSlug(point, id);
    const group = state ? actionGroupsOf(state, point).find((g) => g.slug === slug) : undefined;
    stages.push({
      id: `action:${point}:${id}`,
      kind: 'action',
      section: POINT_SECTION[point],
      name: actionName(action),
      performer: performerOf(config, action),
      condition: null,
      status: state ? actionStatus(state, group) : null,
      group: state && group ? slug : null,
    });
  }
  return stages;
}

/** The split stage with the actions around it; none without a split. */
function splitStages(
  config: ResolvedConfig,
  pipeline: Pipeline,
  state?: RunState,
): PipelineStage[] {
  if (!pipeline.split) return [];
  const split: PipelineStage = {
    id: 'split',
    kind: 'split',
    section: 'prepare',
    name: 'Split',
    performer: specialistPerformer(config, pipeline.split.specialist),
    condition: null,
    status: state ? statusOf(state.split ?? undefined) : null,
    group: state?.split ? SPLIT_GROUP : null,
  };
  return [
    ...actionStages(config, pipeline, 'before_split', state),
    split,
    ...actionStages(config, pipeline, 'after_split', state),
  ];
}

function stepStages(config: ResolvedConfig, pipeline: Pipeline, state?: RunState): PipelineStage[] {
  const steps = groupPipeline(config, pipeline).steps;
  return steps.map((step, index) => ({
    id: `step:${step.id}`,
    kind: 'step',
    section: 'work',
    name: stepLabel(config, steps, step),
    performer: specialistPerformer(config, step.specialist),
    condition: null,
    status: state ? stepStatus(state, step.id, index) : null,
    group: null,
  }));
}

/** The commit message author, the delivery itself and the conflict resolver. */
function deliveryStages(config: ResolvedConfig, state?: RunState): PipelineStage[] {
  const stages: PipelineStage[] = [];
  const { delivery } = config;
  if (delivery.messageSpecialist) {
    stages.push({
      id: 'message',
      kind: 'message',
      section: 'delivery',
      name: 'Commit message',
      performer: specialistPerformer(config, delivery.messageSpecialist),
      condition: 'delivery_commit',
      status: state ? statusOf(state.message ?? undefined) : null,
      group: state?.message ? MESSAGE_GROUP : null,
    });
  }
  stages.push({
    id: 'delivery',
    kind: 'delivery',
    section: 'delivery',
    name: 'Delivery',
    performer: SYSTEM,
    condition: null,
    status: state ? deliveryStatus(state) : null,
    group: null,
  });
  if (delivery.resolver) {
    stages.push({
      id: 'resolve',
      kind: 'resolve',
      section: 'delivery',
      name: 'Resolve conflicts',
      performer: specialistPerformer(config, delivery.resolver),
      condition: 'conflict',
      status: state ? statusOf(state.resolve ?? undefined) : null,
      group: state?.resolve ? RESOLVE_GROUP : null,
    });
  }
  return stages;
}

/**
 * Every stage of a pipeline in the order the pipeline runs them, from the configuration. With a
 * run, each stage carries the status of its group. A stage that is not configured is absent.
 */
export function pipelineStages(
  config: ResolvedConfig,
  pipeline: Pipeline,
  state?: RunState,
): PipelineStage[] {
  const stages: PipelineStage[] = [
    ...splitStages(config, pipeline, state),
    ...stepStages(config, pipeline, state),
    {
      id: 'merge',
      kind: 'merge',
      section: 'merge',
      name: 'Merge',
      performer: SYSTEM,
      condition: null,
      status: state ? mergeStatus(state) : null,
      group: null,
    },
    ...actionStages(config, pipeline, 'before_delivery', state),
    ...deliveryStages(config, state),
    ...actionStages(config, pipeline, 'after_delivery', state),
  ];
  if (!config.delivery.keep) {
    stages.push({
      id: 'cleanup',
      kind: 'cleanup',
      section: 'finish',
      name: 'Cleanup',
      performer: SYSTEM,
      condition: 'not_keep',
      status: state ? cleanupStatus(state) : null,
      group: null,
    });
  }
  return stages;
}

/** The stages of the pipeline of a run, with the status of their groups. */
export function runStages(state: RunState): PipelineStage[] {
  return pipelineStages(state.run.config, runPipeline(state.run), state);
}
