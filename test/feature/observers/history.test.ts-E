import { describe, expect, it, vi } from 'vitest';

import {
  ObserverHistoryService,
  decodeCursor,
  encodeCursor,
  type ObserverHistoryQuery,
} from '../../../src/feature/observers/services/history.ts';

describe('observer history service', () => {
  it('pins repair group, defaults the page size and adds injected asOf', () => {
    const page = vi.fn(() => ({
      items: [],
      projects: [],
      nextCursor: { startedAt: 100, runId: 'run1', seq: 2 },
    }));
    const service = new ObserverHistoryService({ attemptHistory: { page } as never }, () => 1234);
    expect(service.page({ repository: '/old', limit: 50 })).toEqual({
      items: [],
      projects: [],
      nextCursor: encodeCursor({ startedAt: 100, runId: 'run1', seq: 2 }),
      limit: 50,
      asOf: 1234,
    });
    expect(page).toHaveBeenCalledWith({
      group: '_repair',
      repository: '/old',
      limit: 50,
      cursor: undefined,
    });
  });

  it('validates supported filters and time boundaries', () => {
    const page = vi.fn(() => ({ items: [], projects: [], nextCursor: null }));
    const service = new ObserverHistoryService({ attemptHistory: { page } as never }, () => 1);
    for (const query of [
      { limit: 10 },
      { from: -1 },
      { from: 1.5 },
      { from: Number.MAX_SAFE_INTEGER + 1 },
      { from: 20, to: 20 },
      { runtime: 'other' },
      { result: 'other' },
      { model: '' },
      { repository: 'x'.repeat(4097) },
    ] as ObserverHistoryQuery[]) {
      expect(() => service.page(query)).toThrow();
    }
    expect(page).not.toHaveBeenCalled();
  });

  it('round-trips a versioned cursor and rejects malformed or oversized values', () => {
    const cursor = { startedAt: 42, runId: 'run', seq: 3 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    const invalid = [
      '',
      'broken',
      Buffer.from(JSON.stringify({ v: 2, ...cursor })).toString('base64url'),
      Buffer.from(
        JSON.stringify({ v: 1, ...cursor, startedAt: Number.MAX_SAFE_INTEGER + 1 }),
      ).toString('base64url'),
      Buffer.from(JSON.stringify({ v: 1, ...cursor, seq: 0 })).toString('base64url'),
      Buffer.from(JSON.stringify({ v: 1, ...cursor, runId: '' })).toString('base64url'),
      'a'.repeat(2049),
    ];
    for (const value of invalid) {
      expect(() => decodeCursor(value)).toThrow();
    }
  });
});
