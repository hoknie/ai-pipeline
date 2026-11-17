import {
  type ValidateContext,
  addError,
  join,
  readChoice,
  readEntries,
  readInteger,
  readMapping,
  readString,
} from '../validate-context.ts';
import { RUNTIMES } from '../../types/specialist.ts';
import { type FieldError } from '../../types/errors.ts';
import {
  QUEUE_MAX_RANGE,
  QUEUE_SCOPES,
  defaultQueue,
  type QueuePool,
  type QueueSettings,
} from '../../types/settings.ts';

const QUEUE_KEYS = ['scope', 'max', 'pools', 'default_pool'];
const POOL_KEYS = ['max', 'members'];
const DEFAULT_POOL_KEYS = ['max'];
const PLAIN_SELECTORS: readonly string[] = RUNTIMES;
const MODEL_SELECTOR = /^opencode:([^/\s*]+)\/([^\s*]*)(\*?)$/;

/** A selector problem as text; null when the selector is valid. */
function selectorProblem(selector: string): string | null {
  if (PLAIN_SELECTORS.includes(selector)) return null;
  const match = MODEL_SELECTOR.exec(selector);
  if (!match) {
    return `selector \`${selector}\` must be a runtime name (${RUNTIMES.join(', ')}) or opencode:provider/model (a trailing * marks a prefix)`;
  }
  if (match[3] === '' && match[2] === '') {
    return `selector \`${selector}\` must name a model after the provider`;
  }
  return null;
}

/** Whether two valid selectors can match the same runtime and model. */
function selectorsOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  const prefix = (selector: string): string | null =>
    selector.endsWith('*') ? selector.slice(0, -1) : null;
  const leftPrefix = prefix(left);
  const rightPrefix = prefix(right);
  if (leftPrefix !== null && rightPrefix !== null) {
    return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
  }
  if (leftPrefix !== null) return right.startsWith(leftPrefix);
  if (rightPrefix !== null) return left.startsWith(rightPrefix);
  return false;
}

function readMembers(ctx: ValidateContext, value: unknown, path: string): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    addError(ctx, path, 'must be a non-empty list of selectors');
    return null;
  }
  const members: string[] = [];
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    const selector = readString(ctx, item, itemPath);
    if (selector === null) continue;
    const problem = selectorProblem(selector);
    if (problem !== null) {
      addError(ctx, itemPath, problem);
      continue;
    }
    if (members.includes(selector)) {
      addError(ctx, itemPath, `selector \`${selector}\` is listed twice in the pool`);
      continue;
    }
    members.push(selector);
  }
  return members.length > 0 ? members : null;
}

function readPools(ctx: ValidateContext, value: unknown): QueuePool[] | null {
  const path = 'swarm.queue.pools';
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const before = ctx.errors.length;
  const pools: QueuePool[] = [];
  const entries = Object.entries(mapping);
  if (entries.length === 0) addError(ctx, path, 'must not be empty');
  for (const [name, entry] of entries) {
    const poolPath = join(path, name);
    if (name.trim() === '') {
      addError(ctx, poolPath, 'pool name must not be empty');
      continue;
    }
    const pool = readMapping(ctx, entry, poolPath);
    if (!pool) continue;
    let max: number | null = null;
    let members: string[] | null = null;
    const fields = readEntries(ctx, pool, poolPath, POOL_KEYS);
    for (const [key, field] of fields) {
      if (key === 'max') max = readInteger(ctx, field, join(poolPath, 'max'), QUEUE_MAX_RANGE);
      if (key === 'members') members = readMembers(ctx, field, join(poolPath, 'members'));
    }
    if (!fields.some(([key]) => key === 'max')) addError(ctx, join(poolPath, 'max'), 'is required');
    if (!fields.some(([key]) => key === 'members')) {
      addError(ctx, join(poolPath, 'members'), 'is required');
    }
    if (max !== null && members !== null) pools.push({ name, max, members });
  }
  // A selector of one pool may not match what another pool matches.
  for (const [index, pool] of pools.entries()) {
    for (const [memberIndex, selector] of pool.members.entries()) {
      const clash = pools
        .slice(0, index)
        .find((other) => other.members.some((member) => selectorsOverlap(member, selector)));
      if (clash) {
        addError(
          ctx,
          `${join(path, pool.name)}.members[${memberIndex}]`,
          `selector \`${selector}\` overlaps a selector of the pool \`${clash.name}\``,
        );
      }
    }
  }
  return ctx.errors.length === before ? pools : null;
}

/** Checks `swarm.queue`; fills `queue` with the valid fields. */
export function checkQueue(ctx: ValidateContext, value: unknown, queue: QueueSettings): void {
  const mapping = readMapping(ctx, value, 'swarm.queue');
  if (!mapping) return;
  let pools: QueuePool[] | null = null;
  let poolsSet = false;
  let defaultSet = false;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.queue', QUEUE_KEYS)) {
    const path = join('swarm.queue', key);
    if (key === 'scope') queue.scope = readChoice(ctx, field, path, QUEUE_SCOPES) ?? queue.scope;
    if (key === 'max') queue.max = readInteger(ctx, field, path, QUEUE_MAX_RANGE) ?? queue.max;
    if (key === 'pools') {
      poolsSet = true;
      pools = readPools(ctx, field);
    }
    if (key === 'default_pool') {
      defaultSet = true;
      const section = readMapping(ctx, field, path);
      if (!section) continue;
      for (const [name, item] of readEntries(ctx, section, path, DEFAULT_POOL_KEYS)) {
        const max = readInteger(ctx, item, join(path, name), QUEUE_MAX_RANGE);
        if (max !== null) queue.defaultPool = { max };
      }
      if (!('max' in section)) addError(ctx, join(path, 'max'), 'is required');
    }
  }
  if (poolsSet && !defaultSet) {
    addError(ctx, 'swarm.queue.default_pool', 'is required when queue.pools is set');
  }
  if (defaultSet && !poolsSet) {
    addError(ctx, 'swarm.queue.default_pool', 'is set only together with queue.pools');
  }
  // Pools work only whole: any error drops them all.
  if (pools !== null && poolsSet && queue.defaultPool !== null) queue.pools = pools;
  else queue.defaultPool = null;
}

/** Checks the `queue` section alone; `value` is the content of `swarm.queue`. */
export function validateQueueSection(value: unknown): {
  queue: QueueSettings;
  errors: FieldError[];
} {
  const ctx: ValidateContext = { errors: [] };
  const queue = defaultQueue();
  if (value !== undefined) checkQueue(ctx, value, queue);
  return { queue, errors: ctx.errors };
}
