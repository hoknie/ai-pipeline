import type { QueueItem } from '../../../../feature/queue/types/index.ts';
import { isRunFinished, type RunState } from '../../../../feature/runs/types/index.ts';

/**
 * Whether removing the item cleans its run up: a returned run that is finished and not cleaned up.
 * A frozen (unfinished) run and a plain task never are.
 */
export function cleansRun(item: QueueItem, lookup: (id: string) => RunState | undefined): boolean {
  if (item.run === null) return false;
  const state = lookup(item.run);
  return state !== undefined && isRunFinished(state) && state.run.cleanedAt === null;
}

/** `cleanedAt` and `cleanable` of a run: it can be cleaned up when finished and not cleaned yet. */
export function cleanMarks(state: RunState): { cleanedAt: number | null; cleanable: boolean } {
  return {
    cleanedAt: state.run.cleanedAt,
    cleanable: isRunFinished(state) && state.run.cleanedAt === null,
  };
}

/** The run fields of a queue item: whether removing it cleans the run, and the hold of the run. */
export function itemRunMarks(
  item: QueueItem,
  lookup: (id: string) => RunState | undefined,
): { cleansRun: boolean; hold: RunState['run']['hold'] } {
  return {
    cleansRun: cleansRun(item, lookup),
    hold: (item.run === null ? undefined : lookup(item.run)?.run.hold) ?? null,
  };
}
