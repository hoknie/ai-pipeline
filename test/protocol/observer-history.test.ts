import { describe, expect, it } from 'vitest';

import { requestSchema } from '../../src/presentation/ipc/contract/index.ts';
import { observerHistoryView } from '../../src/presentation/ipc/views/observer-history.ts';

describe('observer history IPC contract', () => {
  it('accepts the supported page sizes and rejects invalid query values', () => {
    for (const limit of [20, 50, 100]) {
      expect(
        requestSchema.safeParse({ method: 'observers_history', params: { limit } }).success,
      ).toBe(true);
    }
    for (const params of [
      { limit: 10 },
      { runtime: 'unknown' },
      { result: 'other' },
      { from: -1 },
      { from: 1.5 },
      { from: 10, to: 10 },
      { cursor: 'x'.repeat(2049) },
    ]) {
      expect(requestSchema.safeParse({ method: 'observers_history', params }).success).toBe(false);
    }
  });

  it('projects only history fields and preserves unknown versus zero usage', () => {
    const view = observerHistoryView({
      items: [
        {
          id: 'r:_repair:1',
          runId: 'r',
          runNumber: 1,
          runTitle: 'Task',
          repository: '/repo',
          attemptSeq: 1,
          runtime: 'agy',
          model: null,
          startedAt: 1,
          finishedAt: null,
          status: 'running',
          verdict: null,
          result: 'running',
          failureKind: null,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
        },
      ],
      nextCursor: null,
      limit: 20,
      projects: ['/repo'],
      asOf: 5,
    });
    expect(view.items[0]?.usage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: null });
    expect(view.items[0]).not.toHaveProperty('input');
    expect(view.items[0]).not.toHaveProperty('sessionId');
  });
});
