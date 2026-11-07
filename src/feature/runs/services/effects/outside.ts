import { isAbsolute, relative, sep } from 'node:path';

import {
  changedPaths,
  hashFiles,
  snapshotWorkingCopy,
  under,
  type Snapshot,
} from '../../../../platform/git/index.ts';
import type { DeliveryResult } from '../../machine/index.ts';
import type { RunState } from '../../types/index.ts';

import { keyOf, type AttemptKey } from './context.ts';
import { workspaceOf } from './worktrees.ts';

interface Baseline {
  repository: string;
  exclude: string[];
  snapshot: Snapshot;
  /** Content of paths aip itself wrote into the working copy while the attempt ran. */
  overrides: Map<string, string>;
}

function deliveredPaths(result: DeliveryResult): string[] {
  return result.kind === 'applied' ? [...new Set([...result.files, ...result.conflicts])] : [];
}

/** The directory of the working copies, when it lies inside the repository. */
function excluded(state: RunState): string[] {
  const path = relative(state.run.repository, workspaceOf(state));
  if (path === '' || path.startsWith('..') || isAbsolute(path)) return [];
  return [path.split(sep).join('/')];
}

async function snapshot(state: RunState, exclude: string[]): Promise<Snapshot | null> {
  if (state.run.config.outsideChanges === 'off') return null;
  try {
    return await snapshotWorkingCopy(state.run.repository, { exclude });
  } catch {
    return null;
  }
}

/** Changes the agents made to the user's working copy outside their worktrees. */
export class OutsideChanges {
  /** Working copy of the repository as it was when each running attempt started. */
  private readonly baselines = new Map<string, Baseline>();

  /** Remembers the working copy as the attempt starts. */
  async begin(state: RunState, key: AttemptKey): Promise<void> {
    const exclude = excluded(state);
    const before = await snapshot(state, exclude);
    if (!before) return;
    this.baselines.set(keyOf(key), {
      repository: state.run.repository,
      exclude,
      snapshot: before,
      overrides: new Map(),
    });
  }

  /** The paths changed outside since the attempt started; forgets the attempt. */
  async finish(state: RunState, key: AttemptKey): Promise<string[]> {
    const baseline = this.baselines.get(keyOf(key));
    this.baselines.delete(keyOf(key));
    const after = baseline ? await snapshot(state, baseline.exclude) : null;
    if (!baseline || !after) return [];
    try {
      return await changedPaths(baseline.repository, baseline.snapshot, after, baseline.overrides);
    } catch {
      return [];
    }
  }

  forget(key: AttemptKey): void {
    this.baselines.delete(keyOf(key));
  }

  /** Accepts what a delivery wrote into the working copy: it is not a change from outside. */
  async accept(state: RunState, result: DeliveryResult): Promise<void> {
    // The branch mode does not touch the working copy: nothing was written there.
    if (state.run.config.delivery.mode === 'branch') return;
    const repository = state.run.repository;
    const paths = deliveredPaths(result);
    const baselines = [...this.baselines.values()].filter(
      (baseline) => baseline.repository === repository,
    );
    if (baselines.length === 0 || paths.length === 0) return;
    try {
      const current = await hashFiles(repository, paths);
      for (const baseline of baselines) {
        for (const [path, hash] of current) {
          if (!under(path, baseline.exclude)) baseline.overrides.set(path, hash);
        }
      }
    } catch {
      // Without the content the paths stay as they are: at worst a warning is shown.
    }
  }
}
