import { describe, expect, it } from 'vitest';

import type { RunState } from '../../../src/feature/runs/types/index.ts';
import {
  StatsMetaRepository,
  StatsRecordRepository,
  StatsReportRepository,
} from '../../../src/feature/stats/repositories/index.ts';
import { StatsLedger } from '../../../src/feature/stats/services/index.ts';
import type { StatsSettings } from '../../../src/feature/swarm-config/types/index.ts';
import { temporaryStorage } from '../storage.ts';
import { runWith, settle, usage } from './helpers.ts';

/** A ledger on a real database with settings and a clock the test moves. */
function harness(history: RunState[] = [], start = 100_000) {
  const { database } = temporaryStorage();
  const records = new StatsRecordRepository(database);
  const meta = new StatsMetaRepository(database);
  const reads = new StatsReportRepository(database);
  const clock = { now: start };
  const settings: { value: StatsSettings | string } = {
    value: { enabled: true, exclude: [], showCost: true },
  };
  const warnings: string[] = [];
  const build = () =>
    new StatsLedger({
      records,
      meta,
      settings: () => settings.value,
      resolve: async (reference) => reference,
      runs: () => history,
      now: () => clock.now,
      warn: (message) => warnings.push(message),
      settingsCacheMs: 0,
    });
  const attempts = () => reads.attempts({ exclude: [] }).map((record) => record.runId);
  return { build, clock, settings, records, meta, reads, attempts, warnings };
}

const finished = (id: string, at: number, repository = '/work/app') =>
  runWith(id, [{ startedAt: at - 10, finishedAt: at, usage: usage(10, 5) }], { repository });

describe('the statistics ledger', () => {
  it('moves the history once, with the attempts, the naming and the tasks of the finished runs', async () => {
    const old = settle(finished('old', 50_000), 'merged', 50_000);
    old.run.namingUsage = usage(800, 40);
    const h = harness([old, finished('other', 60_000, '/work/lib')]);
    const ledger = h.build();
    await ledger.backfill();
    expect(h.meta.backfilledAt()).toBe(100_000);
    expect(h.attempts().sort()).toEqual(['old', 'old', 'other']);
    expect(h.reads.tasks({ exclude: [] }).map((task) => task.runId)).toEqual(['old']);
    h.records.deleteRepository('/work/app');
    await ledger.backfill();
    await h.build().backfill();
    expect(h.attempts()).toEqual(['other']);
  });

  it('leaves the history of an excluded project out of the move', async () => {
    const h = harness([finished('a', 50_000, '/work/app'), finished('b', 50_000, '/work/lib')]);
    h.settings.value = { enabled: true, exclude: ['/work/lib'], showCost: true };
    await h.build().backfill();
    expect(h.attempts()).toEqual(['a']);
  });

  it('puts the move off while collection is off and does it at the first save with it on', async () => {
    const h = harness([finished('old', 50_000)]);
    h.settings.value = { enabled: false, exclude: [], showCost: true };
    const ledger = h.build();
    await ledger.backfill();
    expect(h.meta.backfilledAt()).toBeNull();
    await ledger.capture(finished('during-off', 100_500));
    expect(h.attempts()).toEqual([]);
    h.settings.value = { enabled: true, exclude: [], showCost: true };
    h.clock.now = 200_000;
    await ledger.capture(finished('new', 200_000));
    expect(h.meta.backfilledAt()).toBe(200_000);
    expect(h.attempts()).toContain('old');
  });

  it('does not record an attempt that ended while collection was off, not even later', async () => {
    const h = harness();
    const ledger = h.build();
    await ledger.backfill();
    const state = finished('r1', 100_100);
    h.settings.value = { enabled: false, exclude: [], showCost: true };
    h.clock.now = 100_200;
    await ledger.capture(state);
    h.settings.value = { enabled: true, exclude: [], showCost: true };
    h.clock.now = 100_300;
    await ledger.capture(state);
    expect(h.attempts()).toEqual([]);
  });

  it('does not record an attempt of an excluded project after the exclusion is lifted or the daemon restarts', async () => {
    const h = harness();
    await h.build().backfill();
    h.clock.now = 100_200;
    const ledger = h.build();
    const state = finished('r1', 100_300);
    h.settings.value = { enabled: true, exclude: ['/work/app'], showCost: true };
    await ledger.capture(state);
    h.settings.value = { enabled: true, exclude: [], showCost: true };
    h.clock.now = 100_400;
    await ledger.capture(state);
    h.clock.now = 200_000;
    await h.build().capture(state);
    expect(h.attempts()).toEqual([]);
    await h.build().capture(finished('r2', 200_100));
    expect(h.attempts()).toEqual(['r2']);
  });

  it('records an attempt once however often the run is saved', async () => {
    const h = harness();
    const ledger = h.build();
    await ledger.backfill();
    h.clock.now = 100_500;
    const state = finished('r1', 100_200);
    for (let i = 0; i < 4; i += 1) await ledger.capture(state);
    expect(h.attempts()).toEqual(['r1']);
  });

  it('keeps decisions of a finished run without keeping every key', async () => {
    const h = harness();
    const ledger = h.build();
    await ledger.backfill();
    h.clock.now = 100_400;
    h.settings.value = { enabled: false, exclude: [], showCost: true };
    const skipped = settle(finished('off', 100_200), 'merged', 100_300);
    await ledger.capture(skipped);
    h.settings.value = { enabled: true, exclude: [], showCost: true };
    h.clock.now = 100_500;
    const kept = settle(finished('on', 100_600), 'merged', 100_700);
    await ledger.capture(kept);
    for (let i = 0; i < 3; i += 1) {
      await ledger.capture(skipped);
      await ledger.capture(kept);
    }
    expect(h.attempts()).toEqual(['on']);
    expect(h.reads.tasks({ exclude: [] }).map((task) => task.runId)).toEqual(['on']);
    expect((ledger as unknown as { decided: Set<string> }).decided.size).toBe(0);
  });

  it('updates the task when the run finishes again', async () => {
    const h = harness();
    const ledger = h.build();
    await ledger.backfill();
    const state = settle(finished('r1', 100_200), 'failed', 100_300);
    h.clock.now = 100_400;
    await ledger.capture(state);
    settle(state, 'merged', 100_900);
    h.clock.now = 101_000;
    await ledger.capture(state);
    expect(h.reads.tasks({ exclude: [] })).toMatchObject([
      { outcome: 'finished', finishedAt: 100_900 },
    ]);
  });

  it('treats an invalid section as collection off', async () => {
    const h = harness();
    const ledger = h.build();
    await ledger.backfill();
    h.settings.value = 'invalid swarm.stats: enabled must be a boolean';
    await ledger.capture(finished('r1', 100_200));
    expect(h.attempts()).toEqual([]);
  });

  it('never throws: a failure of the journal is only reported', async () => {
    const h = harness();
    const ledger = h.build();
    await ledger.backfill();
    h.records.insertAttempts = () => {
      throw new Error('disk full');
    };
    await expect(ledger.capture(finished('r1', 100_200))).resolves.toBeUndefined();
    expect(h.warnings.join()).toContain('disk full');
  });

  it('clears a project without moving the history again', async () => {
    const h = harness([finished('old', 50_000)]);
    const ledger = h.build();
    await ledger.backfill();
    expect(ledger.clear('/work/app')).toBe(1);
    await h.build().backfill();
    expect(h.attempts()).toEqual([]);
  });
});
