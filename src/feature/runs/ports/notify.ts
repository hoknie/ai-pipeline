import type { RunState } from '../types/index.ts';

/**
 * Tells the notifications that a run was saved. Set against the arrows of the graph by the
 * composition root. It is called inside the queue of changes, so it only takes what it needs from
 * the state and returns: no waiting for a network, no write to the state of a run.
 */
export interface RunNotifyPort {
  runChanged(state: RunState): void;
}
