import { describe, expect, it } from 'vitest';
import type { Usage } from '../../../src/feature/agents/types/index.ts';
import type { AttemptHistoryItem } from '../../../src/feature/runs/types/history/attempt-history.ts';

import {
  attemptHistoryId,
  attemptHistoryResult,
  attemptHistoryTitle,
} from '../../../src/feature/runs/types/history/attempt-history.ts';

describe('attempt history types helpers', () => {
  it.each([
    ['running', null, 'running'],
    ['finished', 'done', 'done'],
    ['finished', 'rejected', 'rejected'],
    ['finished', 'needs_human', 'needs_human'],
    ['failed', null, 'failed'],
    ['cancelled', null, 'cancelled'],
    ['finished', null, 'unknown'],
  ] as const)('maps %s/%s to %s', (status, verdict, result) => {
    expect(attemptHistoryResult(status, verdict)).toBe(result);
  });

  it('builds stable ids and falls back from title to name to id', () => {
    expect(attemptHistoryId('run/a', 2)).toBe('run/a:_repair:2');
    expect(attemptHistoryTitle('Title', 'Name', 'id')).toBe('Title');
    expect(attemptHistoryTitle(null, 'Name', 'id')).toBe('Name');
    expect(attemptHistoryTitle(null, null, 'id')).toBe('id');
  });

  it('keeps unknown and zero values distinct in the structural contract', () => {
    const usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: null };
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: null });
    const item = { model: null, usage } as Pick<AttemptHistoryItem, 'model' | 'usage'>;
    expect(item.model).toBeNull();
    expect(item.usage?.inputTokens).toBe(0);
    expect(item.usage?.costUsd).toBeNull();
  });
});
