import type { FinishedRunRepository, RunRepository } from '../repositories/index.ts';
import type { RunState } from '../types/index.ts';

/** The stored runs, read without a daemon: for cleaning the state directory. */
export class RunArchive {
  private readonly runs: RunRepository;
  private readonly finished: FinishedRunRepository;

  constructor(runs: RunRepository, finished: FinishedRunRepository) {
    this.runs = runs;
    this.finished = finished;
  }

  load(id: string): RunState | undefined {
    return this.runs.loadRun(id) ?? undefined;
  }

  /** Finished runs, the latest finished first. */
  finishedRuns(): RunState[] {
    return this.finished.finishedRuns();
  }
}
