import type { Database } from '../../../platform/sqlite/index.ts';
import { type Effect, transition } from '../machine/index.ts';
import type { RunRepository } from '../repositories/index.ts';
import type { RunState } from '../types/index.ts';

/** A run after a daemon restart and the effects the daemon must perform for it. */
export type RecoveredRun = { state: RunState; effects: Effect[] };

/**
 * Marks what the old daemon left running as interrupted: active runs and finished runs whose
 * delivery had not finished. The returned effects (a restarted delivery) are for the daemon.
 * The whole scenario is one transaction opened here.
 */
export function recoverRuns(database: Database, runs: RunRepository, now: number): RecoveredRun[] {
  return database.transaction(() => {
    const states = [...runs.activeRuns(), ...runs.deliveringRuns()];
    return states.map((state) => {
      const effects = transition(state, { kind: 'interrupted' }, now);
      runs.writeRun(state);
      return { state, effects };
    });
  });
}
