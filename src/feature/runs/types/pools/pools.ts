import type { DefaultQueuePool, QueuePool } from '../../../swarm-config/types/index.ts';
import { COMMAND_RUNTIME } from '../constants.ts';
import { type RunState, allGroups } from '../run.ts';

/** The quotas of the machine by runtime and model: no pools, no quotas. */
export interface PoolConfig {
  pools: QueuePool[];
  defaultPool: DefaultQueuePool | null;
}

/** The pool an attempt takes a place in: the `key` counts the places, the `name` is shown. */
export interface PoolSlot {
  key: string;
  name: string;
  max: number;
}

/** The name the quota of the attempts outside every pool is shown under. */
export const DEFAULT_POOL_NAME = 'default';

const DEFAULT_POOL_KEY = '\0default';

/** Whether a selector (`claude`, `opencode`, `opencode:provider/model`, a trailing `*`) takes the attempt. */
export function selectorMatches(selector: string, runtime: string, model: string | null): boolean {
  if (!selector.startsWith('opencode:')) {
    if (selector === 'opencode') return runtime === 'opencode' && (model === null || model === '');
    return selector === runtime;
  }
  if (runtime !== 'opencode' || model === null) return false;
  const wanted = selector.slice('opencode:'.length);
  return wanted.endsWith('*') ? model.startsWith(wanted.slice(0, -1)) : model === wanted;
}

/** The pool of an attempt on `runtime` and `model`; null when no pools are set. */
export function poolOf(config: PoolConfig, runtime: string, model: string | null): PoolSlot | null {
  if (config.pools.length === 0 || config.defaultPool === null) return null;
  const pool = config.pools.find((candidate) =>
    candidate.members.some((selector) => selectorMatches(selector, runtime, model)),
  );
  if (pool) return { key: pool.name, name: pool.name, max: pool.max };
  return { key: DEFAULT_POOL_KEY, name: DEFAULT_POOL_NAME, max: config.defaultPool.max };
}

/** Running agent attempts of each pool by the runtime and model they actually started with. */
export function runningByPool(states: RunState[], config: PoolConfig): Map<string, number> {
  const counts = new Map<string, number>();
  if (config.pools.length === 0) return counts;
  for (const state of states) {
    for (const group of allGroups(state)) {
      for (const attempt of group.attempts) {
        if (attempt.status !== 'running' || attempt.runtime === COMMAND_RUNTIME) continue;
        const slot = poolOf(config, attempt.runtime, attempt.model);
        if (slot) counts.set(slot.key, (counts.get(slot.key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * A number of the waiting attempt that does not depend on the time: the same attempt gets the same
 * number every time the scheduler looks at it, so a `random` chain keeps its choice.
 */
export function attemptSeed(run: string, group: string, step: string, seq: number): number {
  let hash = 0x811c9dc5;
  for (const char of `${run}/${group}/${step}/${seq}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
