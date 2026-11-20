import { describe, expect, it } from 'vitest';

import {
  StatsMetaRepository,
  StatsRecordRepository,
  StatsReportRepository,
} from '../../../src/feature/stats/repositories/index.ts';
import { StatsLedger, StatsReportService } from '../../../src/feature/stats/services/index.ts';
import { recordsOf } from '../../../src/feature/stats/types/index.ts';
import { temporaryStorage } from '../storage.ts';
import { attemptRecord, runWith, settle, taskRecord, usage } from './helpers.ts';

const NOW = 1_000_000;

function harness() {
  const { database } = temporaryStorage();
  const records = new StatsRecordRepository(database);
  const reads = new StatsReportRepository(database);
  const meta = new StatsMetaRepository(database);
  const settings = { enabled: true };
  const ledger = () =>
    new StatsLedger({
      records,
      meta,
      settings: () => ({ enabled: settings.enabled, exclude: [] }),
      resolve: async (reference) => reference,
      runs: () => [],
      now: () => NOW,
      warn: () => undefined,
      settingsCacheMs: 0,
    });
  const service = new StatsReportService({
    reads,
    meta,
    settings: () => ({ enabled: true, exclude: [] }),
    resolve: async (reference) => reference,
    config: () => null,
    now: () => NOW,
  });
  const addRun = (id: string, author: string | null, tokens: number) => {
    records.insertAttempts([
      attemptRecord({
        runId: id,
        author,
        inputTokens: tokens,
        outputTokens: 0,
        finishedAt: NOW - 10,
      }),
    ]);
    records.upsertTask(taskRecord({ runId: id, author, finishedAt: NOW - 10 }));
  };
  const insertRun = (id: string, author: string | null) =>
    database
      .prepare(
        `INSERT INTO runs (id, repository, pipeline, base_commit, branch, created_at, config_json,
           dirty_warning, next_merge_seq, author_id) VALUES (?, '/work/app', 'f', 'abc', 'b', 1, '{}', 0, 0, ?)`,
      )
      .run(id, author);
  return { records, reads, meta, ledger, service, settings, addRun, insertRun };
}

describe('the author in the usage journal', () => {
  it('takes the author of the run into the attempts, the naming and the task', () => {
    const state = settle(
      runWith('r1', [{ startedAt: 1000, finishedAt: 2000, usage: usage(1, 1) }]),
      'merged',
      3000,
    );
    state.run.author = 'alice';
    state.run.namingUsage = usage(5, 1);
    const { attempts, task } = recordsOf(state);
    expect(attempts.map((record) => record.author)).toEqual(['alice', 'alice']);
    expect(task?.author).toBe('alice');
  });

  it('leaves the author empty for a run without one', () => {
    const state = settle(runWith('r2', [{ startedAt: 1000, finishedAt: 2000 }]), 'merged', 3000);
    const { attempts, task } = recordsOf(state);
    expect(attempts[0]?.author).toBeNull();
    expect(task?.author).toBeNull();
  });

  it('stores and reads the author of attempts and tasks, and updates it with the task', () => {
    const h = harness();
    h.addRun('a1', 'alice', 10);
    expect(h.reads.attempts({ exclude: [] })[0]?.author).toBe('alice');
    expect(h.reads.tasks({ exclude: [] })[0]?.author).toBe('alice');
    expect(h.reads.attempts({ exclude: [], author: 'bob' })).toEqual([]);
    expect(h.reads.tasks({ exclude: [], author: 'alice' })).toHaveLength(1);
  });

  it('fills the author of the old records once, from the runs, and not again', async () => {
    const h = harness();
    h.meta.markBackfilled(1);
    h.addRun('old', null, 10);
    h.addRun('none', null, 10);
    h.insertRun('old', 'alice');
    h.insertRun('none', null);
    await h.ledger().backfill();
    expect(h.meta.authorBackfilledAt()).toBe(NOW);
    const authors = (author: string | undefined) =>
      h.reads.attempts({ exclude: [], ...(author === undefined ? {} : { author }) });
    expect(authors('alice').map((record) => record.runId)).toEqual(['old']);
    expect(h.reads.tasks({ exclude: [], author: 'alice' })).toHaveLength(1);
    expect(authors(undefined).find((record) => record.runId === 'none')?.author).toBeNull();
    // a later change of the runs table is not copied: the move is done
    h.insertRun('late', 'bob');
    h.addRun('late', null, 10);
    await h.ledger().backfill();
    expect(authors('bob')).toEqual([]);
  });

  it('puts the filling off while collection is off', async () => {
    const h = harness();
    h.meta.markBackfilled(1);
    h.addRun('old', null, 10);
    h.insertRun('old', 'alice');
    h.settings.enabled = false;
    await h.ledger().backfill();
    expect(h.meta.authorBackfilledAt()).toBeNull();
    expect(h.reads.attempts({ exclude: [], author: 'alice' })).toEqual([]);
    h.settings.enabled = true;
    await h.ledger().backfill();
    expect(h.reads.attempts({ exclude: [], author: 'alice' })).toHaveLength(1);
  });

  it('fills the authors when collection is turned on in a running daemon', async () => {
    const h = harness();
    h.meta.markBackfilled(1);
    h.addRun('old', null, 10);
    h.insertRun('old', 'alice');
    h.settings.enabled = false;
    const ledger = h.ledger();
    await ledger.backfill();
    expect(h.meta.authorBackfilledAt()).toBeNull();
    h.settings.enabled = true;
    await ledger.capture(settle(runWith('new', [{ startedAt: 1, finishedAt: 2 }]), 'merged', 3));
    expect(h.meta.authorBackfilledAt()).toBe(NOW);
    expect(h.reads.attempts({ exclude: [], author: 'alice' })).toHaveLength(1);
  });
});

describe('the report by author', () => {
  it('counts only the records of the author in every part of the report', async () => {
    const h = harness();
    h.addRun('a', 'alice', 80_000);
    h.addRun('b', 'bob', 20_000);
    const report = await h.service.report({ author: 'bob' });
    expect(report.totals).toMatchObject({ tasks: 1, tokens: 20_000 });
    expect(report.bySpecialist.map((row) => row.tokens)).toEqual([20_000]);
    expect(report.series.reduce((total, day) => total + day.tokens, 0)).toBe(20_000);
    expect((await h.service.report({})).totals.tokens).toBe(100_000);
  });

  it('breaks the usage down by author with `none` for the records without one', async () => {
    const h = harness();
    h.addRun('a', 'alice', 80_000);
    h.addRun('b', 'bob', 20_000);
    h.addRun('c', null, 5_000);
    const report = await h.service.report({ byAuthor: true });
    expect(report.byAuthor?.map((row) => [row.key, row.tokens])).toEqual([
      ['alice', 80_000],
      ['bob', 20_000],
      ['none', 5_000],
    ]);
  });

  it('has no breakdown by author unless asked', async () => {
    const h = harness();
    h.addRun('a', 'alice', 1);
    expect((await h.service.report({})).byAuthor).toBeUndefined();
  });
});
