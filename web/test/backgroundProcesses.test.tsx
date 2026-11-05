// @vitest-environment jsdom
import { createInstance } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PROCESS_POLL_MS,
  groupProcessesByTask,
  useBackgroundProcesses,
} from '../src/backgroundProcesses.ts';
import { formatCpu, formatMemory, formatUptime } from '../src/format.ts';
import type { StreamedProcesses } from '../src/store.ts';
import { en } from '../src/i18n/locales/en.ts';
import { ru } from '../src/i18n/locales/ru.ts';

import { fakeApi, processView } from './fixtures.ts';
import { act, cleanup, renderHook } from './render.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function visibility(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
}

describe('useBackgroundProcesses', () => {
  beforeEach(() => vi.useFakeTimers());

  it('asks at once, then every three seconds', async () => {
    const api = fakeApi({ processes: vi.fn(async () => ({ processes: [processView()] })) });
    const { result } = renderHook(() => useBackgroundProcesses(api));
    expect(result.current.processes).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.processes).toHaveLength(1);
    expect(api.processes).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESS_POLL_MS * 2);
    });
    expect(api.processes).toHaveBeenCalledTimes(3);
  });

  it('asks once while the stream is live and has sent the list', async () => {
    const api = fakeApi({ processes: vi.fn(async () => ({ processes: [] })) });
    const { result, rerender } = renderHook(
      ({ streamed }) => useBackgroundProcesses(api, streamed, 'live'),
      { initialProps: { streamed: null as StreamedProcesses | null } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ streamed: { processes: [processView()], error: null } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESS_POLL_MS * 3);
    });
    expect(api.processes).toHaveBeenCalledTimes(1);
    expect(result.current.processes).toHaveLength(1);
  });

  it('asks every interval while the stream reconnects', async () => {
    const api = fakeApi({ processes: vi.fn(async () => ({ processes: [] })) });
    const streamed: StreamedProcesses = { processes: [processView()], error: null };
    renderHook(() => useBackgroundProcesses(api, streamed, 'reconnecting'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESS_POLL_MS * 2);
    });
    expect(api.processes).toHaveBeenCalledTimes(3);
  });

  it('asks every interval while a live stream has sent no list (an older daemon)', async () => {
    const api = fakeApi({ processes: vi.fn(async () => ({ processes: [] })) });
    renderHook(() => useBackgroundProcesses(api, null, 'live'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESS_POLL_MS * 2);
    });
    expect(api.processes).toHaveBeenCalledTimes(3);
  });

  it('shows the error of the stream', async () => {
    const api = fakeApi({ processes: vi.fn(() => new Promise<never>(() => undefined)) });
    const streamed: StreamedProcesses = { processes: null, error: 'no ps' };
    const { result } = renderHook(() => useBackgroundProcesses(api, streamed, 'live'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBe('no ps');
  });

  it('stops while the page is hidden and asks at once when it is visible again', async () => {
    const api = fakeApi();
    renderHook(() => useBackgroundProcesses(api));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    visibility('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESS_POLL_MS * 3);
    });
    expect(api.processes).toHaveBeenCalledTimes(1);
    visibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.processes).toHaveBeenCalledTimes(2);
  });

  it('keeps the error and clears it on the next answer', async () => {
    const processes = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ processes: [] });
    const api = fakeApi({ processes });
    const { result } = renderHook(() => useBackgroundProcesses(api));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBe('boom');
    expect(result.current.processes).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESS_POLL_MS);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.processes).toEqual([]);
  });
});

describe('formats', () => {
  const t = createInstance({
    lng: 'en',
    resources: { en: { translation: en }, ru: { translation: ru } },
  });
  void t.init();

  it('writes the uptime', () => {
    expect(formatUptime(45, t.t)).toBe('45 s');
    expect(formatUptime(125, t.t)).toBe('2 min 5 s');
    expect(formatUptime(3 * 3600 + 2 * 60 + 9, t.t)).toBe('3 h 2 min');
    const russian = t.getFixedT('ru');
    expect(formatUptime(45, russian)).toBe('45 с');
    expect(formatUptime(125, russian)).toBe('2 мин 5 с');
    expect(formatUptime(3 * 3600 + 2 * 60, russian)).toBe('3 ч 2 мин');
  });

  it('writes the CPU with one decimal', () => {
    expect(formatCpu(12, 'en')).toBe('12.0 %');
    expect(formatCpu(12, 'ru')).toBe('12,0 %');
  });

  it('writes the memory', () => {
    expect(formatMemory(120 * 1024 ** 2, t.t, 'en')).toBe('120 MB');
    expect(formatMemory(1.5 * 1024 ** 3, t.t, 'en')).toBe('1.5 GB');
    expect(formatMemory(1.5 * 1024 ** 3, t.getFixedT('ru'), 'ru')).toBe('1,5 ГБ');
    expect(formatMemory(512 * 1024, t.t, 'en')).toBe('512 KB');
  });
});

describe('groupProcessesByTask', () => {
  const p = (pid: number, group: string | null, runId = 'run1') =>
    processView({ pid, owner: { ...processView().owner, runId, group } });

  it('returns nothing for an empty list', () => {
    expect(groupProcessesByTask([])).toEqual([]);
  });

  it('keeps the order of tasks and of processes inside them', () => {
    const tasks = groupProcessesByTask([p(1, 'a'), p(2, 'b'), p(3, 'a')]);
    expect(tasks.map((t) => t.processes.map((x) => x.pid))).toEqual([[1, 3], [2]]);
    expect(tasks.map((t) => t.owner.group)).toEqual(['a', 'b']);
  });

  it('separates the same group of two runs', () => {
    expect(groupProcessesByTask([p(1, 'a'), p(2, 'a', 'run2')])).toHaveLength(2);
  });

  it('makes a task of a run for a process without a group', () => {
    const tasks = groupProcessesByTask([p(1, null), p(2, 'a'), p(3, null)]);
    expect(tasks.map((t) => t.processes.length)).toEqual([2, 1]);
  });
});
