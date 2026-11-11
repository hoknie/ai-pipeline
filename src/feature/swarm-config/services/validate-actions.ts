import {
  type ValidateContext,
  addError,
  join,
  type Range,
  readChoice,
  readEntries,
  readInteger,
  readMapping,
  readString,
} from './validate-context.ts';
import {
  type Action,
  ACTION_FAILURES,
  ACTION_POINTS,
  type ActionFailure,
  type ActionPoint,
  DEFAULT_ACTION_TIMEOUT_SECONDS,
  type StagePoints,
} from '../types/action.ts';
import { isValidSlug, SLUG_PATTERN_TEXT } from '../types/lookups.ts';

const ACTION_KEYS = ['name', 'run', 'specialist', 'additional_prompt', 'timeout', 'on_failure'];

const ACTION_TIMEOUT_RANGE: Range = [1, 86400];

/** Action ids the pipeline points may name, and the actions that were read. */
export interface ActionLookup {
  known: string[];
  actions: Action[];
}

export function checkActions(ctx: ValidateContext, value: unknown, known: string[]): Action[] {
  const mapping = readMapping(ctx, value, 'swarm.actions');
  if (!mapping) return [];
  return readEntries(ctx, mapping, 'swarm.actions', null).flatMap(([id, field]) => {
    const path = join('swarm.actions', id);
    if (!isValidSlug(id)) addError(ctx, path, `id must match ${SLUG_PATTERN_TEXT}`);
    const action = checkAction(ctx, id, field, path, known);
    return action ? [action] : [];
  });
}

/** `run`: one script as a string, or a non-empty list of scripts. */
function readScripts(ctx: ValidateContext, value: unknown, path: string): string[] | null {
  if (!Array.isArray(value)) {
    if (typeof value !== 'string') {
      addError(ctx, path, 'must be a string or a list of strings');
      return null;
    }
    const script = readString(ctx, value, path);
    return script === null ? null : [script];
  }
  if (value.length === 0) {
    addError(ctx, path, 'must not be empty');
    return null;
  }
  const scripts = value.map((item, index) => readString(ctx, item, `${path}[${index}]`));
  return scripts.every((script) => script !== null) ? (scripts as string[]) : null;
}

export function checkAction(
  ctx: ValidateContext,
  id: string,
  value: unknown,
  path: string,
  known: string[],
): Action | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const action: Action = {
    id,
    name: null,
    run: null,
    specialist: null,
    additionalPrompt: null,
    timeoutSeconds: DEFAULT_ACTION_TIMEOUT_SECONDS,
    onFailure: 'stop',
    level: 'project',
  };
  for (const [key, field] of readEntries(ctx, mapping, path, ACTION_KEYS)) {
    const fieldPath = join(path, key);
    switch (key) {
      case 'name':
        action.name = readString(ctx, field, fieldPath)?.trim() ?? null;
        break;
      case 'run':
        action.run = readScripts(ctx, field, fieldPath);
        break;
      case 'specialist': {
        const slug = readString(ctx, field, fieldPath);
        if (slug !== null && !known.includes(slug)) {
          addError(ctx, fieldPath, `unknown specialist \`${slug}\`; known: ${known.join(', ')}`);
        }
        action.specialist = slug;
        break;
      }
      case 'additional_prompt':
        action.additionalPrompt = readString(ctx, field, fieldPath);
        break;
      case 'timeout':
        action.timeoutSeconds =
          readInteger(ctx, field, fieldPath, ACTION_TIMEOUT_RANGE) ?? action.timeoutSeconds;
        break;
      case 'on_failure':
        action.onFailure =
          readChoice<ActionFailure>(ctx, field, fieldPath, ACTION_FAILURES) ?? action.onFailure;
        break;
    }
  }
  if ('run' in mapping && 'specialist' in mapping) {
    addError(ctx, path, 'must have exactly one of `run` and `specialist`, not both');
  } else if (!('run' in mapping) && !('specialist' in mapping)) {
    addError(ctx, path, 'must have one of `run` and `specialist`');
  }
  if ('timeout' in mapping && 'specialist' in mapping && !('run' in mapping)) {
    addError(ctx, join(path, 'timeout'), 'is allowed only with `run`');
  }
  if ('additional_prompt' in mapping && !('specialist' in mapping)) {
    addError(ctx, join(path, 'additional_prompt'), 'is allowed only with `specialist`');
  }
  return action;
}

/** The points of `swarm.stages` or of the `stages` of a pipeline. */
export function checkStagePoints(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  lookup: ActionLookup,
  pipeline: { split: boolean } | null,
): StagePoints {
  const points: StagePoints = {};
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return points;
  for (const [point, field] of readEntries(ctx, mapping, path, [...ACTION_POINTS])) {
    const pointPath = join(path, point);
    if (!Array.isArray(field)) {
      addError(ctx, pointPath, 'must be a list of action ids');
      continue;
    }
    if (pipeline && !pipeline.split && (point === 'before_split' || point === 'after_split')) {
      addError(ctx, pointPath, 'is allowed only in a pipeline with `split`');
      continue;
    }
    const ids: string[] = [];
    for (const [index, item] of field.entries()) {
      const itemPath = `${pointPath}[${index}]`;
      const id = readString(ctx, item, itemPath);
      if (id === null) continue;
      if (!lookup.known.includes(id)) {
        addError(ctx, itemPath, `unknown action \`${id}\`; known: ${lookup.known.join(', ')}`);
        continue;
      }
      if (ids.includes(id)) {
        addError(ctx, itemPath, `duplicate action \`${id}\``);
        continue;
      }
      const action = lookup.actions.find((candidate) => candidate.id === id);
      if (point === 'after_delivery' && action?.specialist) {
        addError(ctx, itemPath, 'only commands (`run`) are allowed after delivery');
        continue;
      }
      ids.push(id);
    }
    points[point as ActionPoint] = ids;
  }
  return points;
}
