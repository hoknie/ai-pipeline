import { describe, expect, it } from 'vitest';

import {
  StatsMetaRepository,
  StatsRecordRepository,
  StatsReportRepository,
} from '../../../src/feature/stats/repositories/index.ts';
import { temporaryStorage } from '../storage.ts';
import { attemptRecord, runWith, taskRecord } from './helpers.ts';

function repositories() {
  const { database } = temporaryStorage();
  return {
    records: new StatsRecordRepository(database),
    reads: new StatsReportRepository(database),
    meta: new StatsMetaRepository(database),
  };
}

describe('statistics repositories', () => {
  it('reads only the recorded usage of one run, including attempts without a task', () => {
    const { records } = repositories();
    expect(records.read('a')).toEqual({ attempts: [], wallMs: null });
    records.insertAttempts([
      attemptRecord({
        runId: 'a',
        group: 'main',
        seq: 1,
        durationMs: 12,
        inputTokens: 3,
        outputTokens: 4,
      }),
      attemptRecord({ runId: 'b', seq: 1 }),
    ]);
    expect(records.read('a')).toEqual({
      attempts: [
        { runId: 'a', group: 'main', seq: 1, durationMs: 12, inputTokens: 3, outputTokens: 4 },
      ],
      wallMs: null,
    });
    records.upsertTask(taskRecord({ runId: 'a', wallMs: 0 }));
    expect(records.read('a').wallMs).toBe(0);
    expect(records.read('b').wallMs).toBeNull();
  });

  it('does not duplicate an attempt inserted twice', () => {
    const { records, reads } = repositories();
    const record = attemptRecord();
    expect(records.insertAttempts([record])).toBe(1);
    expect(records.insertAttempts([record])).toBe(0);
    expect(reads.attempts({ exclude: [] })).toEqual([record]);
  });

  it('changes the result of a task on an upsert', () => {
    const { records, reads } = repositories();
    const task = taskRecord({ outcome: 'failed', finishedAt: 5000 });
    records.upsertTask(task);
    records.upsertTask({ ...task, outcome: 'finished', finishedAt: 9000 });
    expect(reads.tasks({ exclude: [] })).toEqual([
      { ...task, outcome: 'finished', finishedAt: 9000 },
    ]);
  });

  it('filters by period, project and exclusion', () => {
    const { records, reads } = repositories();
    records.insertAttempts([
      attemptRecord({ runId: 'a', finishedAt: 1000, repository: '/work/app' }),
      attemptRecord({ runId: 'b', finishedAt: 5000, repository: '/work/app' }),
      attemptRecord({ runId: 'c', finishedAt: 5000, repository: '/work/lib' }),
    ]);
    const ids = (scope: Parameters<typeof reads.attempts>[0]) =>
      reads.attempts(scope).map((record) => record.runId);
    expect(ids({ exclude: [] })).toEqual(['a', 'b', 'c']);
    expect(ids({ since: 2000, exclude: [] })).toEqual(['b', 'c']);
    expect(ids({ until: 2000, exclude: [] })).toEqual(['a']);
    expect(ids({ repository: '/work/lib', exclude: [] })).toEqual(['c']);
    expect(ids({ exclude: ['/work/lib'] })).toEqual(['a', 'b']);
    expect(reads.firstFinished([])).toBe(1000);
    expect(reads.firstFinished(['/work/app', '/work/lib'])).toBeNull();
  });

  it('reads every record of the given runs whatever the period', () => {
    const { records, reads } = repositories();
    records.insertAttempts([
      attemptRecord({ runId: 'a', seq: 1, finishedAt: 1000 }),
      attemptRecord({ runId: 'a', seq: 2, finishedAt: 9000 }),
      attemptRecord({ runId: 'b', seq: 1, finishedAt: 9000 }),
    ]);
    expect(reads.attemptsOfRuns(['a']).map((record) => record.seq)).toEqual([1, 2]);
    expect(reads.attemptsOfRuns([])).toEqual([]);
  });

  it('deletes the records of one project and counts them', () => {
    const { records, reads } = repositories();
    records.insertAttempts([
      attemptRecord({ runId: 'a', repository: '/work/app' }),
      attemptRecord({ runId: 'b', repository: '/work/app', seq: 2 }),
      attemptRecord({ runId: 'c', repository: '/work/lib' }),
    ]);
    records.upsertTask(taskRecord({ runId: 'a', repository: '/work/app' }));
    expect(records.deleteRepository('/work/app')).toBe(3);
    expect(reads.attempts({ exclude: [] }).map((record) => record.runId)).toEqual(['c']);
    expect(reads.tasks({ exclude: [] })).toEqual([]);
  });

  it('marks the records of probe runs and keeps them out of the report', () => {
    const storage = temporaryStorage();
    const records = new StatsRecordRepository(storage.database);
    const reads = new StatsReportRepository(storage.database);
    records.insertAttempts([
      attemptRecord({ runId: 'plain', seq: 1 }),
      attemptRecord({ runId: 'probe', seq: 1 }),
    ]);
    records.upsertTask(taskRecord({ runId: 'probe' }));
    const saved = runWith('probe', []);
    saved.run.probeOf = 'source';
    storage.runs.saveRun(saved);
    records.fillProbeRuns();
    expect(reads.attempts({ exclude: [] }).map((record) => record.runId)).toEqual(['plain']);
    expect(reads.tasks({ exclude: [] })).toEqual([]);
    expect(records.read('probe')).toEqual({
      attempts: [
        {
          runId: 'probe',
          group: 'group-1',
          seq: 1,
          durationMs: 1000,
          inputTokens: 100,
          outputTokens: 50,
        },
      ],
      wallMs: 4000,
    });
    records.markProbes(['plain']);
    expect(reads.attempts({ exclude: [] })).toEqual([]);
    expect(records.read('plain').attempts).toHaveLength(1);
    records.fillProbeRuns();
    records.markProbes(['plain']);
    expect(records.read('plain').attempts).toHaveLength(1);
  });

  it('keeps the moment of the history move', () => {
    const { meta } = repositories();
    expect(meta.backfilledAt()).toBeNull();
    meta.markBackfilled(123);
    expect(meta.backfilledAt()).toBe(123);
  });
});
