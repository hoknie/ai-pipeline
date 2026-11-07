import type { RunState } from '../types/index.ts';

/** The diffs and patches of the groups of a run, computed outside the run. */
export interface DiffPort {
  /** Keeps the patch of the merged groups; failures never reach the caller. */
  savePatch(state: RunState): Promise<void>;
  /** Recomputes the diff statistics of a group in the background. */
  refreshDiff(state: RunState, slug: string): Promise<void>;
}
