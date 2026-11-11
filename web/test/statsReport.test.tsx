// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StatsReportView } from '../src/shared/api/types.ts';
import { REFETCH_MS, useStatsReport } from '../src/features/stats/useStatsReport.ts';

import { fakeApi, runView, statsReportView } from './fixtures.ts';

afterEach(() => vi.useRealTimers());

function deferred() {
  let resolve!: (report: StatsReportView) => void;
  const promise = new Promise<StatsReportView>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const withTokens = (tokens: number) =>
  statsReportView({ totals: { ...statsReportView().totals, tokens, tasks: 1, attempts: 1 } });

describe('useStatsReport', () => {
  it('does not let an outdated answer replace the answer to a newer request', async () => {
    const slow = deferred();
    const fast = deferred();
    const statsReport = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const api = fakeApi({ statsReport });
    const { result, rerender } = renderHook(({ period }) => useStatsReport(api, period, null, []), {
      initialProps: { period: '30d' as '30d' | '7d' },
    });
    rerender({ period: '7d' });
    await act(async () => fast.resolve(withTokens(7)));
    await waitFor(() => expect(result.current.report?.totals.tokens).toBe(7));
    await act(async () => slow.resolve(withTokens(30)));
    expect(result.current.report?.totals.tokens).toBe(7);
  });

  it('asks for the period and the project', async () => {
    const api = fakeApi();
    renderHook(() => useStatsReport(api, '7d', '/work/app', []));
    await waitFor(() => expect(api.statsReport).toHaveBeenCalled());
    const query = vi.mocked(api.statsReport).mock.calls[0]?.[0];
    expect(query?.repository).toBe('/work/app');
    expect(typeof query?.since).toBe('number');
    expect(query?.until).toBeUndefined();
  });

  it('asks for all time without a start', async () => {
    const api = fakeApi();
    renderHook(() => useStatsReport(api, 'all', null, []));
    await waitFor(() => expect(api.statsReport).toHaveBeenCalled());
    expect(vi.mocked(api.statsReport).mock.calls[0]?.[0]).toEqual({});
  });

  it('keeps the error and reads again on reload', async () => {
    const statsReport = vi
      .fn()
      .mockRejectedValueOnce(new Error('daemon is down'))
      .mockResolvedValueOnce(withTokens(5));
    const api = fakeApi({ statsReport });
    const { result } = renderHook(() => useStatsReport(api, '30d', null, []));
    await waitFor(() => expect(result.current.error).toBe('daemon is down'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.report?.totals.tokens).toBe(5));
    expect(result.current.error).toBeNull();
  });
});

describe('refetch on run events', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  it('reads again after a run changes, not oftener than every 5 seconds', async () => {
    const statsReport = vi
      .fn()
      .mockResolvedValueOnce(withTokens(1))
      .mockResolvedValue(withTokens(2));
    const api = fakeApi({ statsReport });
    const { result, rerender } = renderHook(({ runs }) => useStatsReport(api, '30d', null, runs), {
      initialProps: { runs: [runView({ counts: '0/2' })] },
    });
    await waitFor(() => expect(result.current.report?.totals.tokens).toBe(1));
    rerender({ runs: [runView({ counts: '1/2' })] });
    expect(statsReport).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFETCH_MS + 50);
    });
    await waitFor(() => expect(result.current.report?.totals.tokens).toBe(2));
    expect(statsReport).toHaveBeenCalledTimes(2);
  });

  it('does not read again while the runs stay the same', async () => {
    const api = fakeApi();
    const runs = [runView()];
    const { rerender } = renderHook(() => useStatsReport(api, '30d', null, runs));
    await waitFor(() => expect(api.statsReport).toHaveBeenCalledTimes(1));
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFETCH_MS * 2);
    });
    expect(api.statsReport).toHaveBeenCalledTimes(1);
  });
});
