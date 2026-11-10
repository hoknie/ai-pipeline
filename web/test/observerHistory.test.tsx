// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  formatDuration,
  formatRunHref,
  formatTime,
  formatUsd,
} from '../src/features/settings/observers/history/format.ts';
import { observerHistory, type ObserverHistoryPage } from '../src/shared/api/observerHistoryApi.ts';
import { ApiError } from '../src/shared/api/http.ts';
import { useHistory } from '../src/features/settings/observers/useHistory.ts';
import { fakeApi } from './fixtures.ts';
import { act, renderHook, waitFor } from './render.tsx';

describe('observer history formatting', () => {
  it('builds the repair group link for the stable run id', () => {
    expect(formatRunHref('run/one')).toContain('run%2Fone');
    expect(formatRunHref('run/one')).toContain('_repair');
  });
  it('distinguishes unknown and zero metrics and formats precise time and duration', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.000001)).not.toBe('—');
    expect(formatTime(0)).toBeTruthy();
    expect(formatDuration(1000, null, 61000)).toContain('1m');
    expect(formatDuration(1000, 61000, 999999)).not.toContain('…');
  });
});

describe('observer history api client', () => {
  const samplePage: ObserverHistoryPage = {
    items: [
      {
        id: 'r1:_repair:1',
        runId: 'r1',
        runNumber: 1,
        runTitle: 'Task 1',
        repository: '/work/app',
        attemptSeq: 1,
        runtime: 'claude',
        model: null,
        startedAt: 100,
        finishedAt: 200,
        status: 'finished',
        verdict: 'done',
        result: 'done',
        failureKind: null,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      },
    ],
    nextCursor: 'cur1',
    limit: 20,
    projects: ['/work/app'],
    asOf: 500,
  };

  it('serializes filters without implicit repository and parses valid response with nulls and zeros', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify(samplePage), { status: 200 });
      }),
    );

    const page = await observerHistory({
      runtime: 'claude',
      model: 'sonnet',
      result: 'done',
      from: 10,
      to: 50,
      limit: 50,
      cursor: 'abc',
    });

    expect(requestedUrl).toBe(
      '/api/observers/history?runtime=claude&model=sonnet&result=done&from=10&to=50&limit=50&cursor=abc',
    );
    expect(page.items[0]?.model).toBeNull();
    expect(page.items[0]?.usage?.inputTokens).toBe(0);
    expect(page.items[0]?.usage?.costUsd).toBe(0);
    vi.unstubAllGlobals();
  });

  it('throws ApiError 502 when daemon returns invalid response or unexpected shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ notA: 'page' }), { status: 200 })),
    );

    await expect(observerHistory()).rejects.toThrow(ApiError);
    await expect(observerHistory()).rejects.toMatchObject({ status: 502 });
    vi.unstubAllGlobals();
  });

  it('rejects malformed history items and invalid projects with 502', async () => {
    for (const malformed of [
      { ...samplePage, items: [{ id: 'x', runId: 'r' }] },
      { ...samplePage, items: [{ ...samplePage.items[0]!, startedAt: 'bad' }] },
      { ...samplePage, items: [{ ...samplePage.items[0]!, startedAt: Number.MAX_SAFE_INTEGER }] },
      { ...samplePage, items: [{ ...samplePage.items[0]!, startedAt: -1 }] },
      { ...samplePage, items: [{ ...samplePage.items[0]!, finishedAt: Number.MAX_SAFE_INTEGER }] },
      { ...samplePage, items: [{ ...samplePage.items[0]!, runtime: 'unknown-runtime' }] },
      { ...samplePage, items: [{ ...samplePage.items[0]!, status: 'waiting' }] },
      { ...samplePage, items: [{ ...samplePage.items[0]!, verdict: 'unknown-verdict' }] },
      { ...samplePage, items: [{ ...samplePage.items[0]!, status: 'waiting' }] },
      { ...samplePage, items: [{ ...samplePage.items[0]!, verdict: 'wat' }] },
      { ...samplePage, asOf: Number.MAX_SAFE_INTEGER },
      {
        ...samplePage,
        items: [
          { ...samplePage.items[0]!, usage: { inputTokens: -1, outputTokens: 0, costUsd: null } },
        ],
      },
      { ...samplePage, items: [{ ...samplePage.items[0]!, result: 'wat' }] },
      { ...samplePage, projects: [42] },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(malformed), { status: 200 })),
      );
      await expect(observerHistory()).rejects.toMatchObject({ status: 502 });
      vi.unstubAllGlobals();
    }
  });

  it('propagates standard HTTP errors from daemon', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Internal error', { status: 500 })),
    );

    await expect(observerHistory()).rejects.toThrow(ApiError);
    await expect(observerHistory()).rejects.toMatchObject({ status: 500 });
    vi.unstubAllGlobals();
  });
});

describe('useHistory hook', () => {
  const page1: ObserverHistoryPage = {
    items: [
      {
        id: 'item1',
        runId: 'r1',
        runNumber: 1,
        runTitle: 'Task 1',
        repository: '/repo',
        attemptSeq: 1,
        runtime: 'claude',
        model: 'm1',
        startedAt: 100,
        finishedAt: 200,
        status: 'finished',
        verdict: 'done',
        result: 'done',
        failureKind: null,
        usage: null,
      },
    ],
    nextCursor: 'cur2',
    limit: 20,
    projects: ['/repo'],
    asOf: 200,
  };

  const page2: ObserverHistoryPage = {
    items: [
      {
        id: 'item2',
        runId: 'r2',
        runNumber: 2,
        runTitle: 'Task 2',
        repository: '/repo',
        attemptSeq: 1,
        runtime: 'claude',
        model: 'm1',
        startedAt: 50,
        finishedAt: 80,
        status: 'finished',
        verdict: 'done',
        result: 'done',
        failureKind: null,
        usage: null,
      },
    ],
    nextCursor: null,
    limit: 20,
    projects: ['/repo'],
    asOf: 200,
  };

  it('navigates with next, back, refresh, reset and handles pagination edges', async () => {
    const api = fakeApi({
      observerHistory: vi.fn(async (query) => {
        if (query?.cursor === 'cur2') return page2;
        return page1;
      }),
    });

    const { result } = renderHook(() => useHistory(api));
    await waitFor(() => expect(result.current.page).toEqual(page1));
    expect(result.current.canBack).toBe(false);

    // next() advances to page2
    act(() => {
      result.current.next();
    });
    await waitFor(() => expect(result.current.page).toEqual(page2));
    expect(result.current.canBack).toBe(true);

    // back() returns to page1
    act(() => {
      result.current.back();
    });
    await waitFor(() => expect(result.current.page).toEqual(page1));
    expect(result.current.canBack).toBe(false);

    // update filter and reset()
    act(() => {
      result.current.update({ result: 'done', runtime: 'claude' });
    });
    expect(result.current.filters.result).toBe('done');
    expect(result.current.filters.runtime).toBe('claude');

    act(() => {
      result.current.reset();
    });
    expect(result.current.filters.result).toBeUndefined();
    expect(result.current.filters.runtime).toBeUndefined();
  });

  it('handles race conditions: slower older request does not overwrite newer request', async () => {
    let resolveFirst: (p: ObserverHistoryPage) => void = () => {};
    let resolveSecond: (p: ObserverHistoryPage) => void = () => {};

    const api = fakeApi({
      observerHistory: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<ObserverHistoryPage>((res) => {
              resolveFirst = res;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<ObserverHistoryPage>((res) => {
              resolveSecond = res;
            }),
        ),
    });

    const { result } = renderHook(() => useHistory(api));

    // trigger second query
    act(() => {
      result.current.update({ model: 'newer-model' });
    });

    // resolve second (newer) request first
    act(() => {
      resolveSecond(page2);
    });
    await waitFor(() => expect(result.current.page).toEqual(page2));

    // resolve first (older) request later - it must be ignored
    act(() => {
      resolveFirst(page1);
    });
    expect(result.current.page).toEqual(page2);
  });

  it('does not advance cursor stack when next page request fails', async () => {
    const api = fakeApi({
      observerHistory: vi
        .fn()
        .mockResolvedValueOnce(page1)
        .mockRejectedValueOnce(new Error('Network error')),
    });

    const { result } = renderHook(() => useHistory(api));
    await waitFor(() => expect(result.current.page).toEqual(page1));
    expect(result.current.canBack).toBe(false);

    act(() => {
      result.current.next();
    });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.canBack).toBe(false);
  });

  it('exposes 1-based pageNumber and keeps the current page on retry', async () => {
    const api = fakeApi({
      observerHistory: vi
        .fn()
        .mockResolvedValueOnce(page1)
        .mockRejectedValueOnce(new Error('Page 2 failed'))
        .mockResolvedValueOnce(page2),
    });

    const { result } = renderHook(() => useHistory(api));
    await waitFor(() => expect(result.current.page).toEqual(page1));
    expect(result.current.pageNumber).toBe(1);

    act(() => {
      result.current.next();
    });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.page).toEqual(page1);
    expect(result.current.pageNumber).toBe(1);

    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.page).toEqual(page2));
    expect(result.current.pageNumber).toBe(2);
    expect(result.current.error).toBeNull();
  });
});
