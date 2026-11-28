import type { RunState } from '../../types/index.ts';

/** The recorded usage of one run; absent run records have no wall time. */
export interface RunStatsPort {
  /** Wait until this snapshot's completed attempts have been decided by the journal. */
  capture(state: RunState): Promise<void>;
  /**
   * Marks the records of these runs as probes in the journal: the members of the experiments of
   * older stores, which the table of runs cannot name a probe.
   */
  markProbes(runIds: string[]): void;
  read(runId: string): {
    attempts: {
      runId: string;
      group: string;
      seq: number;
      durationMs: number;
      inputTokens: number;
      outputTokens: number;
    }[];
    wallMs: number | null;
  };
}
