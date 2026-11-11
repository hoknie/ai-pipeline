import { describe, expect, it } from 'vitest';

import { recordsOf } from '../../../src/feature/stats/types/index.ts';
import { runWith, settle, usage } from './helpers.ts';

describe('records of a saved run', () => {
  it('leaves a running attempt out', () => {
    const state = runWith('r1', [
      { startedAt: 1000, finishedAt: 2000, usage: usage(10, 5, 0.1) },
      { startedAt: 3000, finishedAt: null, usage: usage(50_000, 0) },
    ]);
    const { attempts, task } = recordsOf(state);
    expect(attempts.map((record) => record.seq)).toEqual([1]);
    expect(task).toBeNull();
  });

  it('records the project, the runtime, the model, the time and the usage of an attempt', () => {
    const state = runWith(
      'r2',
      [
        {
          startedAt: 1000,
          finishedAt: 91_000,
          usage: usage(12_000, 3_000, 0.42),
          model: 'sonnet',
          specialist: 'coder',
        },
      ],
      { repository: '/work/app' },
    );
    const [record] = recordsOf(state).attempts;
    expect(record).toMatchObject({
      runId: 'r2',
      repository: '/work/app',
      pipeline: 'feature',
      kind: 'step',
      specialist: 'coder',
      runtime: 'claude',
      model: 'sonnet',
      status: 'finished',
      durationMs: 90_000,
      inputTokens: 12_000,
      outputTokens: 3_000,
      costUsd: 0.42,
    });
  });

  it('writes an attempt without usage as zeros and a cost of null', () => {
    const [record] = recordsOf(runWith('r3', [{ startedAt: 1000, finishedAt: 2000 }])).attempts;
    expect(record).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: null });
    const [agy] = recordsOf(
      runWith('r3b', [{ startedAt: 1, finishedAt: 2, runtime: 'agy', usage: usage(5000, 0) }]),
    ).attempts;
    expect(agy).toMatchObject({ inputTokens: 5000, costUsd: null, runtime: 'agy' });
  });

  it('adds the naming call as its own record without time', () => {
    const state = runWith('r4', [], { createdAt: 777 });
    state.run.namingUsage = usage(800, 40, 0.01);
    const { attempts } = recordsOf(state);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      kind: 'naming',
      group: '_naming',
      seq: 0,
      inputTokens: 800,
      outputTokens: 40,
      durationMs: 0,
      finishedAt: 777,
    });
  });

  it('makes a task of a finished run with its full time and result', () => {
    const state = settle(runWith('r5', [], { createdAt: 10_000 }), 'merged', 10_000 + 90 * 60_000);
    expect(recordsOf(state).task).toMatchObject({
      runId: 'r5',
      wallMs: 90 * 60_000,
      outcome: 'finished',
    });
    expect(recordsOf(settle(runWith('r6', []), 'failed', 9000)).task?.outcome).toBe('failed');
    expect(recordsOf(settle(runWith('r7', []), 'cancelled', 9000)).task?.outcome).toBe('cancelled');
  });

  it('gives a task a new finish when the run finishes again', () => {
    const state = settle(runWith('r8', []), 'failed', 5000);
    const first = recordsOf(state).task;
    settle(state, 'merged', 9000);
    const second = recordsOf(state).task;
    expect([first?.outcome, second?.outcome]).toEqual(['failed', 'finished']);
    expect(second?.finishedAt).toBe(9000);
    expect(second?.runId).toBe(first?.runId);
  });
});
