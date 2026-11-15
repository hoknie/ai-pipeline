import {
  type ValidateContext,
  join,
  readChoice,
  readEntries,
  readInteger,
  readMapping,
} from '../validate-context.ts';
import { type FieldError } from '../../types/errors.ts';
import {
  QUEUE_MAX_RANGE,
  QUEUE_SCOPES,
  defaultQueue,
  type QueueSettings,
} from '../../types/settings.ts';

const QUEUE_KEYS = ['scope', 'max'];

/** Checks `swarm.queue`; fills `queue` with the valid fields. */
export function checkQueue(ctx: ValidateContext, value: unknown, queue: QueueSettings): void {
  const mapping = readMapping(ctx, value, 'swarm.queue');
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.queue', QUEUE_KEYS)) {
    const path = join('swarm.queue', key);
    if (key === 'scope') queue.scope = readChoice(ctx, field, path, QUEUE_SCOPES) ?? queue.scope;
    if (key === 'max') queue.max = readInteger(ctx, field, path, QUEUE_MAX_RANGE) ?? queue.max;
  }
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
