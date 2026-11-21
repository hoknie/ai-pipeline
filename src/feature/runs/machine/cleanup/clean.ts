import { rejected } from '../../../../platform/errors/index.ts';
import { isRunFinished, retryableGroups } from '../../types/index.ts';
import type { Ctx, Effect } from '../events.ts';

/**
 * Retrying and delivering a cleaned-up run is refused: its worktrees and service refs are gone.
 * Only a request that would have gone on is refused so: a group that cannot be retried, or a
 * delivery with nothing waiting, keeps its own error.
 */
export function rejectCleaned(m: Ctx, request: 'retry' | 'deliver'): void {
  const { state } = m;
  if (state.run.cleanedAt === null) return;
  const open =
    request === 'retry'
      ? retryableGroups(state).length > 0
      : state.groups.some(
          (group) => group.status === 'merged' && group.delivery.state !== 'applied',
        );
  if (open) throw rejected('run is cleaned up');
}

/** The user (or a removed queue item) cleans a finished run up; a second request keeps the time. */
export function cleanRunMark(m: Ctx): void {
  if (!isRunFinished(m.state)) {
    throw rejected('the run is still active; cancel it or wait for it to finish');
  }
  m.state.run.cleanedAt ??= m.now;
}

/** A cleanup effect of the transition (after delivery) marks the run as cleaned up in the same step. */
export function markCleanedByEffects(m: Ctx, effects: readonly Effect[]): void {
  if (effects.some((effect) => effect.kind === 'cleanup')) m.state.run.cleanedAt ??= m.now;
}
