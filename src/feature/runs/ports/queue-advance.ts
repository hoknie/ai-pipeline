import type { OnLimit, RunState } from '../types/index.ts';

/** The queue of the repository of a run: it advances when its runs change. */
export interface QueueAdvancePort {
  /** A run was saved: the queue of its repository looks at it once more. */
  runChanged(state: RunState): void;
  /** Moments a queue stopped by a usage limit may start again. */
  wakeMoments(): number[];
  /** Starts the queues that resume after a usage limit. */
  wake(): Promise<void>;
  /** What a usage limit does to the groups of the repository's runs: the queue's setting. */
  onLimitOf(repository: string): OnLimit;
}
