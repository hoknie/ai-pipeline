import { resolve as resolvePath } from 'node:path';

import type { RunState } from '../../runs/types/index.ts';
import type { StatsSettings } from '../../swarm-config/types/index.ts';
import type { StatsMetaRepository, StatsRecordRepository } from '../repositories/index.ts';
import {
  type AttemptRecord,
  type LedgerSettings,
  type TaskRecord,
  attemptKey,
  recordsOf,
} from '../types/index.ts';

/** What the ledger reads from the other features. */
export interface LedgerDependencies {
  records: StatsRecordRepository;
  meta: StatsMetaRepository;
  /** The `stats` of the shared settings.yaml, or the text of the error in it. */
  settings: () => StatsSettings | string;
  /** The root of a project path as the registry sees it; refuses unknown paths. */
  resolve: (reference: string) => Promise<string>;
  /** Every run that is saved: the ones in memory and the finished ones of the database. */
  runs: () => Iterable<RunState>;
  now: () => number;
  /** Reports a failure of the journal; the run goes on. */
  warn: (message: string) => void;
  /** How long a read of the settings stays valid. */
  settingsCacheMs?: number;
}

const DEFAULT_CACHE_MS = 2000;

/**
 * The usage journal: decides whether a saved run leaves records and writes them. An attempt that
 * ended while collection was off or its project excluded is decided once and never recorded later.
 */
export class StatsLedger {
  private readonly dependencies: LedgerDependencies;
  private cache: { at: number; settings: LedgerSettings } | null = null;
  /** Attempts and tasks decided in this life of the daemon, recorded or not. */
  private readonly decided = new Set<string>();
  /** Finished runs: everything that ended by this moment is decided, so their keys are dropped. */
  private readonly settled = new Map<string, number>();
  /** Attempts that ended before this moment are left to the history move; null before it. */
  private capturedFrom: number | null;
  private tail: Promise<void> = Promise.resolve();

  constructor(dependencies: LedgerDependencies) {
    this.dependencies = dependencies;
    this.capturedFrom = dependencies.meta.backfilledAt() === null ? null : dependencies.now();
  }

  /** Records what the saved run holds; never throws. */
  capture(state: RunState): Promise<void> {
    let work: () => Promise<void>;
    try {
      const { attempts, task } = recordsOf(state);
      work = () => this.decide(attempts, task);
    } catch (error) {
      this.dependencies.warn(`cannot read run ${state.run.id}: ${String(error)}`);
      return this.tail;
    }
    this.tail = this.tail.then(work).catch((error: unknown) => {
      this.dependencies.warn(`cannot record run ${state.run.id}: ${String(error)}`);
    });
    return this.tail;
  }

  /**
   * Moves the history into the journal once, when collection is on for the first time. Safe to
   * call again: it does nothing after the move.
   */
  async backfill(): Promise<void> {
    try {
      await this.backfillNow(await this.settings());
    } catch (error) {
      this.dependencies.warn(`cannot move the history: ${String(error)}`);
    }
  }

  /** Removes the records of a project; returns how many rows went. Does not move the history again. */
  clear(repository: string): number {
    return this.dependencies.records.deleteRepository(repository);
  }

  private async decide(attempts: AttemptRecord[], task: TaskRecord | null): Promise<void> {
    const { records } = this.dependencies;
    const settings = await this.settings();
    if (this.capturedFrom === null) {
      if (!settings.enabled) return;
      this.backfillNow(settings);
    }
    const from = this.capturedFrom ?? 0;
    const fresh = attempts.filter(
      (record) =>
        record.finishedAt >= from &&
        !this.decided.has(attemptKey(record)) &&
        (this.settled.get(record.runId) ?? -1) < record.finishedAt,
    );
    for (const record of fresh) this.decided.add(attemptKey(record));
    const keep = fresh.filter((record) => this.writes(settings, record.repository));
    if (keep.length > 0) records.insertAttempts(keep);
    if (task === null) return;
    if ((this.settled.get(task.runId) ?? -1) >= task.finishedAt) return;
    if (task.finishedAt >= from && this.writes(settings, task.repository)) records.upsertTask(task);
    let settledAt = task.finishedAt;
    for (const record of attempts) {
      this.decided.delete(attemptKey(record));
      settledAt = Math.max(settledAt, record.finishedAt);
    }
    this.settled.set(task.runId, settledAt);
  }

  private writes(settings: LedgerSettings, repository: string): boolean {
    return settings.enabled && !settings.excluded.has(repository);
  }

  private backfillNow(settings: LedgerSettings): void {
    const { records, meta, now } = this.dependencies;
    if (!settings.enabled || meta.backfilledAt() !== null) return;
    const seen = new Set<string>();
    const attempts: AttemptRecord[] = [];
    const tasks: TaskRecord[] = [];
    for (const state of this.dependencies.runs()) {
      if (seen.has(state.run.id)) continue;
      seen.add(state.run.id);
      if (settings.excluded.has(state.run.repository)) continue;
      const found = recordsOf(state);
      attempts.push(...found.attempts);
      if (found.task !== null) tasks.push(found.task);
    }
    const at = now();
    records.transaction(() => {
      records.insertAttempts(attempts);
      for (const task of tasks) records.upsertTask(task);
      meta.markBackfilled(at);
    });
    this.capturedFrom = at;
  }

  /** The settings now; a read stays valid for a couple of seconds. */
  private async settings(): Promise<LedgerSettings> {
    const { now, settings, resolve } = this.dependencies;
    const at = now();
    const ttl = this.dependencies.settingsCacheMs ?? DEFAULT_CACHE_MS;
    if (this.cache !== null && at - this.cache.at < ttl) return this.cache.settings;
    const read = settings();
    let value: LedgerSettings;
    if (typeof read === 'string') {
      value = { enabled: false, excluded: new Set() };
    } else {
      const excluded = new Set<string>();
      for (const path of read.exclude) {
        excluded.add(await resolve(path).catch(() => resolvePath(path)));
      }
      value = { enabled: read.enabled, excluded };
    }
    this.cache = { at, settings: value };
    return value;
  }
}
