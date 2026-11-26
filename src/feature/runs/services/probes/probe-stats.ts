import type { RunStatsPort } from '../../ports/stats/index.ts';
import { isRunFinished, type RunState } from '../../types/index.ts';

/** Wait for this snapshot's capture before reading measurements for a final proposal. */
export async function probeStats(stats: RunStatsPort, state: RunState) {
  try {
    if (isRunFinished(state)) await stats.capture(state);
    return stats.read(state.run.id);
  } catch {
    // A failed capture is unknown, not zero, and does not block publication.
    return { attempts: [], wallMs: null };
  }
}
