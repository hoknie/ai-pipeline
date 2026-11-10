import { describe, expect, it } from 'vitest';

import { AttemptHistoryRepository } from '../../../src/feature/runs/repositories/index.ts';
import { temporaryStorage } from '../storage.ts';
import { run } from './helpers.ts';

function historyRun() {
  const store = temporaryStorage();
  const state = run(1, { id: 'history-run' });
  store.runs.saveRun(state);
  store.database
    .prepare(
      `INSERT INTO groups
    (run_id, slug, position, title, task, status, pending_json, rejections_json, warnings_json,
     decisions_json, conflict_files_json, merge_in_flight, update_on_conflict)
    VALUES (?, '_repair', 99, 'Repair', 'repair', 'running', NULL, '[]', '[]', '[]', '[]', 0, 0)`,
    )
    .run(state.run.id);
  const repository = new AttemptHistoryRepository(store.database);
  return { store, repository, runId: state.run.id };
}

function insertAttempt(
  store: ReturnType<typeof temporaryStorage>,
  runId: string,
  seq: number,
  fields: {
    startedAt?: number;
    runtime?: string;
    model?: string | null;
    status?: string;
    verdict?: string | null;
    usage?: string | null;
    group?: string;
  } = {},
) {
  const group = fields.group ?? '_repair';
  store.database
    .prepare(
      `INSERT INTO attempts
    (run_id, group_slug, seq, step_id, step_index, round, specialist, runtime, model, status,
     input_json, report_json, started_at, finished_at, usage_json)
     VALUES (?, ?, ?, 'repair', 0, 1, 'observer', ?, ?, ?, '{}', ?, ?, NULL, ?)`,
    )
    .run(
      runId,
      group,
      seq,
      fields.runtime ?? 'agy',
      fields.model ?? null,
      fields.status ?? 'finished',
      fields.verdict ? JSON.stringify({ verdict: fields.verdict }) : null,
      fields.startedAt ?? 100,
      fields.usage ?? null,
    );
}

describe('AttemptHistoryRepository', () => {
  it('uses a stable keyset across equal timestamps and new/deleted boundary rows', () => {
    const { store, repository, runId } = historyRun();
    for (let seq = 1; seq <= 25; seq += 1) insertAttempt(store, runId, seq);
    const first = repository.page({ group: '_repair', limit: 20 });
    expect(first.items.map((item) => item.attemptSeq)).toEqual(
      Array.from({ length: 20 }, (_, index) => 25 - index),
    );
    insertAttempt(store, runId, 26, { startedAt: 101 });
    store.database
      .prepare('DELETE FROM attempts WHERE run_id = :run AND group_slug = :group AND seq = :seq')
      .run({ run: runId, group: '_repair', seq: first.items.at(-1)?.attemptSeq ?? 0 });
    const next = repository.page({ group: '_repair', limit: 20, cursor: first.nextCursor! });
    expect(next.items.map((item) => item.attemptSeq)).toEqual([5, 4, 3, 2, 1]);
    expect(next.nextCursor).toBeNull();
    store.database.close();
  });

  it('applies combined filters and half-open time bounds before limiting', () => {
    const { store, repository, runId } = historyRun();
    insertAttempt(store, runId, 1, { startedAt: 10, runtime: 'agy', model: 'm', verdict: 'done' });
    insertAttempt(store, runId, 2, { startedAt: 20, runtime: 'agy', model: 'm', verdict: 'done' });
    for (let seq = 10; seq < 35; seq += 1) {
      insertAttempt(store, runId, seq, { startedAt: 100 + seq, runtime: 'claude', model: 'other' });
    }
    insertAttempt(store, runId, 3, {
      startedAt: 15,
      runtime: 'claude',
      model: 'other',
      status: 'failed',
    });
    const page = repository.page({
      group: '_repair',
      repository: '/repo',
      runtime: 'agy',
      model: 'm',
      result: 'done',
      from: 10,
      to: 20,
      limit: 20,
    });
    expect(page.items.map((item) => item.attemptSeq)).toEqual([1]);
    expect(page.projects).toEqual(['/repo']);
    expect(repository.page({ group: '_repair', repository: '/missing', limit: 20 }).items).toEqual(
      [],
    );
    insertAttempt(store, runId, 4, { group: 'gruppa-1', startedAt: 30, verdict: 'done' });
    expect(repository.page({ group: '_repair', limit: 100 }).items).toHaveLength(28);
    store.database.close();
  });

  it('preserves nullable values, zero usage and result fallbacks', () => {
    const { store, repository, runId } = historyRun();
    insertAttempt(store, runId, 1, {
      usage: JSON.stringify({ inputTokens: 0, outputTokens: 0, costUsd: null }),
    });
    insertAttempt(store, runId, 2, { status: 'running', usage: null });
    const items = repository.page({ group: '_repair', limit: 20 }).items;
    expect(items.find((item) => item.attemptSeq === 1)).toMatchObject({
      result: 'unknown',
      usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
    });
    expect(items.find((item) => item.attemptSeq === 2)).toMatchObject({
      result: 'running',
      usage: null,
    });
    store.database.close();
  });

  it('matches unknown result filter with every finished row projected as unknown', () => {
    const { store, repository, runId } = historyRun();
    const insertRaw = (seq: number, report: string | null) =>
      store.database
        .prepare(
          `INSERT INTO attempts
      (run_id, group_slug, seq, step_id, step_index, round, specialist, runtime, status, input_json, report_json, started_at)
      VALUES (?, '_repair', ?, 'repair', 0, 1, 'observer', 'agy', 'finished', '{}', ?, ?)`,
        )
        .run(runId, seq, report, seq);
    insertRaw(1, '{}');
    insertRaw(2, '{"verdict":null}');
    insertRaw(3, '{"verdict":"other"}');
    insertRaw(4, '{"verdict":"done"}');
    insertRaw(5, '{"verdict":"rejected"}');
    insertRaw(6, '{"verdict":"needs_human"}');
    insertRaw(7, null);
    const projectedUnknown = repository
      .page({ group: '_repair', limit: 100 })
      .items.filter((item) => item.result === 'unknown')
      .map((item) => item.attemptSeq)
      .sort();
    const filteredUnknown = repository
      .page({ group: '_repair', result: 'unknown', limit: 100 })
      .items.map((item) => item.attemptSeq)
      .sort();
    expect(filteredUnknown).toEqual(projectedUnknown);
    expect(filteredUnknown).toEqual([1, 2, 3, 7]);
    store.database.close();
  });

  it('orders attempts by numeric seq rather than string comparison (seq 10 before seq 2)', () => {
    const { store, repository, runId } = historyRun();
    insertAttempt(store, runId, 2, { startedAt: 50 });
    insertAttempt(store, runId, 10, { startedAt: 50 });
    const page = repository.page({ group: '_repair', limit: 20 });
    expect(page.items.map((it) => it.attemptSeq)).toEqual([10, 2]);
    store.database.close();
  });

  it('uses the ordering index for history selection', () => {
    const { store } = historyRun();
    const plan = store.database
      .prepare(
        `EXPLAIN QUERY PLAN SELECT a.run_id FROM attempts a JOIN runs r ON r.id = a.run_id
        WHERE a.group_slug = ? ORDER BY a.started_at DESC, a.run_id DESC, a.seq DESC LIMIT 21`,
      )
      .all('_repair') as { detail: string }[];
    expect(plan.some((row) => row.detail.includes('attempts_history_order'))).toBe(true);
    store.database.close();
  });
});
