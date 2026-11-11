import {
  type ValidateContext,
  join,
  readBoolean,
  readEntries,
  readMapping,
  readStrings,
} from '../validate-context.ts';
import { type FieldError } from '../../types/errors.ts';
import { defaultStats, type StatsSettings } from '../../types/settings.ts';

const STATS_KEYS = ['enabled', 'exclude', 'show_cost'];

/** Checks `swarm.stats`; fills `stats` with the valid fields. */
export function checkStats(ctx: ValidateContext, value: unknown, stats: StatsSettings): void {
  const mapping = readMapping(ctx, value, 'swarm.stats');
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.stats', STATS_KEYS)) {
    const path = join('swarm.stats', key);
    if (key === 'enabled') stats.enabled = readBoolean(ctx, field, path) ?? stats.enabled;
    if (key === 'exclude') stats.exclude = readStrings(ctx, field, path);
    if (key === 'show_cost') stats.showCost = readBoolean(ctx, field, path) ?? stats.showCost;
  }
}

/** Checks the `stats` section alone; `value` is the content of `swarm.stats`. */
export function validateStatsSection(value: unknown): {
  stats: StatsSettings;
  errors: FieldError[];
} {
  const ctx: ValidateContext = { errors: [] };
  const stats = defaultStats();
  if (value !== undefined) checkStats(ctx, value, stats);
  return { stats, errors: ctx.errors };
}
