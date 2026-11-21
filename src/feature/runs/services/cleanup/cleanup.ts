import type { DiffPort } from '../../ports/index.ts';
import type { RunState } from '../../types/index.ts';
import type { RunEngine } from '../engine.ts';

import { removeRunFiles } from './plan.ts';

export interface RunCleanupDependencies {
  engine: Pick<RunEngine, 'apply'>;
  diff: DiffPort;
}

/**
 * Cleans a finished run up on request: marks it, keeps its patch, then removes the worktrees and
 * service refs. The patch, artifacts, attempt logs and the record of the run stay.
 */
export class RunCleanup {
  private readonly dependencies: RunCleanupDependencies;

  constructor(dependencies: RunCleanupDependencies) {
    this.dependencies = dependencies;
  }

  /** Refuses an unfinished run before anything changes; a second call keeps the first time. */
  async clean(state: RunState, options: { all: boolean }): Promise<string[]> {
    await this.dependencies.engine.apply(state, { kind: 'clean' });
    // The refs the patch is built from go away with the cleanup; a failure never reaches us.
    await this.dependencies.diff.savePatch(state);
    return removeRunFiles(state, options.all);
  }
}
