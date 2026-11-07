import { rejected } from '../../../platform/errors/index.ts';
import type { Database } from '../../../platform/sqlite/index.ts';
import type { FinishedRunRepository, RunRepository } from '../repositories/index.ts';
import { limitHolds, type RunState } from '../types/index.ts';

import { recoverRuns, type RecoveredRun } from './recovery.ts';

export interface RunStatesDependencies {
  database: Database;
  runs: RunRepository;
  finished: FinishedRunRepository;
  now: () => number;
}

/** A page of finished runs and the cursor of the next one. */
export interface FinishedPage {
  runs: RunState[];
  next: string | null;
}

/**
 * The runs the daemon works with: the unfinished ones and those a usage limit still holds live in
 * memory, any other is loaded on first use and stays there. Every change goes through the engine.
 */
export class RunStates {
  private readonly dependencies: RunStatesDependencies;
  private readonly states = new Map<string, RunState>();

  constructor(dependencies: RunStatesDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Marks what the old daemon left running as interrupted and loads the runs into memory, with
   * the finished runs whose usage limit may still hold a runtime. Returns the recovered runs.
   */
  recover(): RecoveredRun[] {
    const { database, runs, now } = this.dependencies;
    const recovered = recoverRuns(database, runs, now());
    for (const { state } of recovered) this.states.set(state.run.id, state);
    for (const id of runs.limitedRunIds()) {
      if (this.states.has(id)) continue;
      const state = runs.loadRun(id);
      if (state && limitHolds([state], now()).size > 0) this.states.set(id, state);
    }
    return recovered;
  }

  /** The run by its id; throws when there is none. */
  get(id: string): RunState {
    const cached = this.states.get(id);
    if (cached) return cached;
    const loaded = this.dependencies.runs.loadRun(id);
    if (!loaded) throw rejected(`unknown run \`${id}\``);
    this.states.set(id, loaded);
    return loaded;
  }

  /** The run by its id, or undefined when there is none. */
  lookup(id: string): RunState | undefined {
    try {
      return this.get(id);
    } catch {
      return undefined;
    }
  }

  /** A new run: it lives in memory from now on. */
  add(state: RunState): void {
    this.states.set(state.run.id, state);
  }

  /** The runs in memory. */
  all(): RunState[] {
    return [...this.states.values()];
  }

  /** The recent runs, each as it is in memory when it is there. */
  recent(): RunState[] {
    return this.dependencies.finished
      .recentRuns()
      .map((stored) => this.states.get(stored.run.id) ?? stored);
  }

  /** A page of finished runs after the cursor `<created_at>.<id>`; `next` is null at the end. */
  page(limit: number, before?: string): FinishedPage {
    let cursor: { createdAt: number; id: string } | undefined;
    if (before !== undefined) {
      const match = /^(\d+)\.(.+)$/.exec(before);
      if (!match) throw rejected('before is not a valid cursor');
      cursor = { createdAt: Number(match[1]), id: match[2] ?? '' };
    }
    const page = this.dependencies.finished.finishedRunsPage(limit, cursor);
    const runs = page.runs.map((stored) => this.states.get(stored.run.id) ?? stored);
    const last = page.runs.at(-1);
    return { runs, next: page.more && last ? `${last.run.createdAt}.${last.run.id}` : null };
  }

  /** Writes the run; the engine tells everyone after. */
  write(state: RunState): void {
    this.dependencies.runs.saveRun(state);
  }

  /** The highest task number of the repository among its runs. */
  maxNumber(repository: string): number {
    return this.dependencies.runs.maxNumber(repository);
  }

  /** The id of the run with the task number in the repository, or null. */
  idByNumber(repository: string, number: number): string | null {
    return this.dependencies.runs.runIdByNumber(repository, number);
  }

  /** The run a queue item became, or null. */
  runOfQueueItem(repository: string, item: string): RunState | null {
    return this.dependencies.runs.runOfQueueItem(repository, item);
  }

  /** Drops a removed tag from the stored runs; no transaction of its own. */
  dropStoredTag(repository: string, id: string): void {
    this.dependencies.runs.dropTag(repository, id);
  }
}
