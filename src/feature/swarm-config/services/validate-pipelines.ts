import { type ActionLookup, checkStagePoints } from './validate-actions.ts';
import {
  type ValidateContext,
  addError,
  checkTagNames,
  join,
  readBoolean,
  readEntries,
  readInteger,
  readMapping,
  readString,
} from './validate-context.ts';
import { isValidSlug, SLUG_PATTERN_TEXT } from '../types/lookups.ts';
import {
  DEFAULT_MAX_GROUPS,
  MAX_GROUPS_RANGE,
  MAX_ROUNDS_RANGE,
  type OnReject,
  type Pipeline,
  type Split,
  type Step,
} from '../types/pipeline.ts';

const SPLIT_KEYS = ['specialist', 'max_groups', 'additional_prompt', 'pipeline', 'workflow'];

const PIPELINE_KEYS = ['name', 'split', 'steps', 'tags', 'stages'];

const STEP_KEYS = ['id', 'specialist', 'on_reject', 'additional_prompt', 'human_review'];

const ON_REJECT_KEYS = ['goto', 'max_rounds'];

export function checkSplitTargets(ctx: ValidateContext, pipelines: Pipeline[]): void {
  for (const pipeline of pipelines) {
    const target = pipeline.split?.pipeline;
    if (!target) continue;
    const path = `swarm.pipelines.${pipeline.id}.split.pipeline`;
    const found = pipelines.find((other) => other.id === target);
    if (!found) {
      addError(
        ctx,
        path,
        `unknown pipeline \`${target}\`; known: ${pipelines.map((other) => other.id).join(', ')}`,
      );
    } else if (found.id === pipeline.id) {
      addError(ctx, path, 'must not point to the pipeline itself');
    } else if (found.split?.pipeline) {
      addError(
        ctx,
        path,
        `pipeline \`${target}\` has its own \`split.pipeline\`; chains are not allowed`,
      );
    }
  }
}

export function checkPipelines(
  ctx: ValidateContext,
  value: unknown,
  known: string[],
  lookup: ActionLookup,
): Pipeline[] {
  const mapping = readMapping(ctx, value, 'swarm.pipelines');
  if (!mapping) return [];
  return readEntries(ctx, mapping, 'swarm.pipelines', null).flatMap(([id, field]) => {
    const path = join('swarm.pipelines', id);
    if (!isValidSlug(id)) addError(ctx, path, `id must match ${SLUG_PATTERN_TEXT}`);
    const pipeline = checkPipeline(ctx, id, field, path, known, lookup);
    return pipeline ? [pipeline] : [];
  });
}

export function checkPipeline(
  ctx: ValidateContext,
  id: string,
  value: unknown,
  path: string,
  known: string[],
  lookup: ActionLookup,
): Pipeline | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  readEntries(ctx, mapping, path, PIPELINE_KEYS);
  // Tags are metadata for the panel: checked here, never part of the pipeline.
  if ('tags' in mapping) checkTagNames(ctx, mapping.tags, join(path, 'tags'));
  const name = 'name' in mapping ? readString(ctx, mapping.name, join(path, 'name')) : null;
  const split =
    'split' in mapping ? checkSplit(ctx, mapping.split, join(path, 'split'), known) : null;
  const stages =
    'stages' in mapping
      ? checkStagePoints(ctx, mapping.stages, join(path, 'stages'), lookup, {
          split: 'split' in mapping,
        })
      : undefined;
  const withStages = <T extends Pipeline>(pipeline: T): Pipeline =>
    stages === undefined ? pipeline : { ...pipeline, stages };
  const stepsPath = join(path, 'steps');
  if (split?.pipeline) {
    if ('steps' in mapping) {
      addError(ctx, stepsPath, 'must not be set together with `split.pipeline`');
      return null;
    }
    return withStages({ id, name: name?.trim() ?? null, split, steps: [] });
  }
  if (!('steps' in mapping)) {
    addError(ctx, stepsPath, 'is required');
    return null;
  }
  if (!Array.isArray(mapping.steps)) {
    addError(ctx, stepsPath, 'must be a list of steps');
    return null;
  }
  if (mapping.steps.length === 0) {
    addError(ctx, stepsPath, 'must not be empty');
    return null;
  }
  const steps = mapping.steps.map((item, index) =>
    checkStep(ctx, item, `${stepsPath}[${index}]`, known),
  );
  steps.forEach((step, index) => {
    const stepPath = `${stepsPath}[${index}]`;
    if (step.id !== '' && steps.findIndex((other) => other.id === step.id) < index) {
      addError(ctx, join(stepPath, 'id'), `duplicate step id \`${step.id}\``);
    }
    if (!step.onReject) return;
    const gotoPath = join(join(stepPath, 'on_reject'), 'goto');
    const target = steps.findIndex((other) => other.id === step.onReject?.goto);
    if (target === -1) addError(ctx, gotoPath, `unknown step \`${step.onReject.goto}\``);
    else if (target >= index) addError(ctx, gotoPath, 'must point to an earlier step');
  });
  return withStages({ id, name: name?.trim() ?? null, split, steps });
}

export function checkSplit(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  known: string[],
): Split | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  readEntries(ctx, mapping, path, SPLIT_KEYS);
  if ('pipeline' in mapping && 'workflow' in mapping) {
    addError(ctx, path, 'has both `pipeline` and the old `workflow`; keep `pipeline`');
  }
  const specialistPath = join(path, 'specialist');
  if (!('specialist' in mapping)) {
    addError(ctx, specialistPath, 'is required');
    return null;
  }
  const specialist = readString(ctx, mapping.specialist, specialistPath);
  if (specialist !== null && !known.includes(specialist)) {
    addError(
      ctx,
      specialistPath,
      `unknown specialist \`${specialist}\`; known: ${known.join(', ')}`,
    );
  }
  const maxGroups =
    'max_groups' in mapping
      ? readInteger(ctx, mapping.max_groups, join(path, 'max_groups'), MAX_GROUPS_RANGE)
      : DEFAULT_MAX_GROUPS;
  const additionalPrompt =
    'additional_prompt' in mapping
      ? readString(ctx, mapping.additional_prompt, join(path, 'additional_prompt'))
      : null;
  const pipeline =
    'pipeline' in mapping ? readString(ctx, mapping.pipeline, join(path, 'pipeline')) : null;
  return specialist !== null && maxGroups !== null
    ? { specialist, maxGroups, additionalPrompt, pipeline }
    : null;
}

export function checkStep(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  known: string[],
): Step {
  const step: Step = {
    id: '',
    specialist: '',
    onReject: null,
    additionalPrompt: null,
    humanReview: false,
  };
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return step;
  for (const [key, field] of readEntries(ctx, mapping, path, STEP_KEYS)) {
    const fieldPath = join(path, key);
    if (key === 'id') step.id = readString(ctx, field, fieldPath) ?? '';
    if (key === 'specialist') {
      const slug = readString(ctx, field, fieldPath);
      if (slug !== null && !known.includes(slug)) {
        addError(ctx, fieldPath, `unknown specialist \`${slug}\`; known: ${known.join(', ')}`);
      }
      step.specialist = slug ?? '';
    }
    if (key === 'on_reject') step.onReject = checkOnReject(ctx, field, fieldPath);
    if (key === 'additional_prompt') step.additionalPrompt = readString(ctx, field, fieldPath);
    if (key === 'human_review') step.humanReview = readBoolean(ctx, field, fieldPath) ?? false;
  }
  if (!('id' in mapping)) addError(ctx, join(path, 'id'), 'is required');
  if (!('specialist' in mapping)) addError(ctx, join(path, 'specialist'), 'is required');
  return step;
}

export function checkOnReject(ctx: ValidateContext, value: unknown, path: string): OnReject | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  readEntries(ctx, mapping, path, ON_REJECT_KEYS);
  const goto = 'goto' in mapping ? readString(ctx, mapping.goto, join(path, 'goto')) : null;
  const maxRounds =
    'max_rounds' in mapping
      ? readInteger(ctx, mapping.max_rounds, join(path, 'max_rounds'), MAX_ROUNDS_RANGE)
      : null;
  if (!('goto' in mapping)) addError(ctx, join(path, 'goto'), 'is required');
  if (!('max_rounds' in mapping)) addError(ctx, join(path, 'max_rounds'), 'is required');
  return goto !== null && maxRounds !== null ? { goto, maxRounds } : null;
}
