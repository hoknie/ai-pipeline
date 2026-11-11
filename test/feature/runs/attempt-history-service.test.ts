import { describe, expect, it } from 'vitest';

import { AttemptHistoryRepository } from '../../../src/feature/runs/repositories/index.ts';
import { RunAttemptHistoryService } from '../../../src/feature/runs/services/attempt-history.ts';
import { createRunsServices } from '../../../src/feature/runs/services/create.ts';
import { DEFAULT_TIMINGS } from '../../../src/app/index.ts';
import { temporaryStorage } from '../storage.ts';
import { run } from './helpers.ts';

describe('RunAttemptHistoryService', () => {
  it('pages persisted attempts without reading run state', () => {
    const store = temporaryStorage();
    const state = run(1, { id: 'old-history-run' });
    store.runs.saveRun(state);
    store.database
      .prepare(
        `INSERT INTO groups
         (run_id, slug, position, title, task, status, pending_json, rejections_json, warnings_json,
          decisions_json, conflict_files_json, merge_in_flight, update_on_conflict)
         VALUES (?, '_repair', 99, 'Repair', 'repair', 'done', NULL, '[]', '[]', '[]', '[]', 0, 0)`,
      )
      .run(state.run.id);
    store.database
      .prepare(
        `INSERT INTO attempts
         (run_id, group_slug, seq, step_id, step_index, round, specialist, runtime, model, status,
          input_json, report_json, started_at, finished_at, usage_json)
         VALUES (?, '_repair', 1, 'repair', 0, 1, 'observer', 'claude', 'old-model', 'finished',
          '{}', '{"verdict":"done"}', 10, 20, '{"inputTokens":0,"outputTokens":7,"costUsd":null}')`,
      )
      .run(state.run.id);

    const service = new RunAttemptHistoryService(new AttemptHistoryRepository(store.database));
    expect(service.page({ group: '_repair', limit: 20 })).toMatchObject({
      items: [
        {
          runId: 'old-history-run',
          attemptSeq: 1,
          runtime: 'claude',
          model: 'old-model',
          result: 'done',
          usage: { inputTokens: 0, outputTokens: 7, costUsd: null },
        },
      ],
    });
    store.database.close();
  });

  it('is wired into the runs service factory as a page-only capability', () => {
    const store = temporaryStorage();
    const services = createRunsServices({
      database: store.database,
      now: () => 1,
      agents: {} as never,
      config: {} as never,
      network: {} as never,
      registry: {} as never,
      socket: '/tmp/aip-test.sock',
      environment: {},
      entry: [],
      graceMs: undefined,
      timings: DEFAULT_TIMINGS,
      queue: {} as never,
      observe: {} as never,
      publish: {} as never,
      diff: {} as never,
      agentExit: {} as never,
    });
    expect(services.attemptHistory).toBeInstanceOf(RunAttemptHistoryService);
    expect(typeof services.attemptHistory.page).toBe('function');
    store.database.close();
  });
});
