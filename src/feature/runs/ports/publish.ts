import type { RunState } from '../types/index.ts';

/** Tells the clients of the daemon about runs. */
export interface RunsPublishPort {
  /** A run was saved: its view and the counters of the repositories. */
  runSaved(state: RunState): void;
  /** The waits of these runs changed; the queues of these repositories may show it. */
  waitsChanged(states: RunState[], repositories: ReadonlySet<string>): void;
}
