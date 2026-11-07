import { rejected } from '../../../platform/errors/index.ts';
import { git, rangePatch, refExists } from '../../../platform/git/index.ts';
import type { RunStates } from '../../runs/services/index.ts';
import { runRef, type RunState } from '../../runs/types/index.ts';
import {
  storageFor,
  type PatchRepository,
  type PatchStorage,
  type RunPatchRecord,
} from '../repositories/index.ts';
import type { RunPatchView } from '../types/index.ts';

export interface PatchDependencies {
  patches: PatchRepository;
  storages: PatchStorage[];
  states: RunStates;
  now: () => number;
  stopping: () => boolean;
}

function hasMergedChanges(state: RunState): boolean {
  return state.groups.some((group) => group.status === 'merged' && group.mergeCommit !== null);
}

/** The patch of the merged groups of each run, kept after its refs are gone. */
export class PatchService {
  private readonly dependencies: PatchDependencies;
  private readonly patching = new Map<string, Promise<void>>();

  constructor(dependencies: PatchDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Keeps the patch of the merged groups of a run in the patch storage and its URI in the
   * database. Serialized per run; failures are written to stderr and never reach the caller.
   */
  save(state: RunState): Promise<void> {
    const id = state.run.id;
    const next = (this.patching.get(id) ?? Promise.resolve())
      .then(() => this.write(state))
      .catch((error: unknown) => {
        if (this.dependencies.stopping()) return;
        process.stderr.write(`aip daemon: cannot save the patch of run ${id}: ${String(error)}\n`);
      });
    this.patching.set(id, next);
    return next;
  }

  /** The stored record of the patch of a run. */
  record(runId: string): RunPatchRecord | null {
    return this.dependencies.patches.runPatch(runId);
  }

  /** Removes patch files of runs the database does not know and superseded ones. */
  async sweep(): Promise<void> {
    const { patches, storages } = this.dependencies;
    const keep = new Map<string, string>();
    for (const id of patches.runPatchIds()) {
      const record = patches.runPatch(id);
      if (record) keep.set(id, record.uri);
    }
    for (const storage of storages) await storage.sweep(keep).catch(() => undefined);
  }

  /** `run_patch`: the stored patch, or one built from the refs while they exist. */
  async runPatch(runId: string): Promise<RunPatchView> {
    const state = this.dependencies.states.get(runId);
    const id = state.run.id;
    if (!hasMergedChanges(state)) throw rejected(`run ${id} has no merged changes`);
    const { repository } = state.run;
    const ref = runRef(state.run);
    const present = await refExists(repository, ref);
    if (present) await this.save(state);
    const record = this.dependencies.patches.runPatch(id);
    let bytes: Buffer | null = null;
    if (record) {
      bytes = (await storageFor(this.dependencies.storages, record.uri)?.get(record.uri)) ?? null;
    }
    if (bytes === null && present) {
      const commit = await git(repository, 'rev-parse', ref);
      bytes = await rangePatch(repository, state.run.baseCommit, commit);
    }
    if (bytes === null) {
      throw rejected(
        present || record
          ? `the patch of run ${id} is not available`
          : `the patch of run ${id} is not available: run refs are removed`,
      );
    }
    return { fileName: `${id}.patch`, size: bytes.length, base64: bytes.toString('base64') };
  }

  private async write(state: RunState): Promise<void> {
    if (!hasMergedChanges(state)) return;
    const { repository, id } = state.run;
    const ref = runRef(state.run);
    if (!(await refExists(repository, ref))) return;
    const commit = await git(repository, 'rev-parse', ref);
    const { patches, storages, now } = this.dependencies;
    const stored = patches.runPatch(id);
    if (stored?.commit === commit) return;
    const bytes = await rangePatch(repository, state.run.baseCommit, commit);
    const uri = await storages[0]!.put(id, commit, bytes);
    patches.setRunPatch(id, { uri, commit, size: bytes.length, createdAt: now() });
    if (stored && stored.uri !== uri) {
      await storageFor(storages, stored.uri)
        ?.remove(stored.uri)
        .catch(() => undefined);
    }
  }
}
