// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { RunList } from '../src/features/runs/list/RunList.tsx';
import { EMPTY_FILTERS } from '../src/features/runs/list/runFilter.ts';
import { useNotificationCenter } from '../src/app/notifications.ts';
import type { RunView } from '../src/shared/api/types.ts';
import { useRuns } from '../src/shared/api/runs/useRuns.ts';
import { useNearEnd } from '../src/shared/lib/browser/useNearEnd.ts';
import { TagsProvider } from '../src/shared/lib/catalog/tags.tsx';

import { FakeEventSource, fakeApi, groupRow, openFake, queueOf, runView } from './fixtures.ts';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from './render.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stream = () => FakeEventSource.last!;
const project = (path: string) => ({
  path,
  displayPath: path,
  addedAt: 1,
  unfinished: 0,
  waiting: 0,
  queued: 0,
});
const done = (id: string) => runView({ id, title: id, finished: true, state: 'finished' });

describe('history of finished runs', () => {
  it('loads two pages by cursor without repeats and stops at the end', async () => {
    const finishedRuns = vi
      .fn()
      .mockResolvedValueOnce({ runs: [done('a'), done('b')], next: 'c1' })
      .mockResolvedValueOnce({ runs: [done('b'), done('c')], next: null });
    const api = fakeApi({ finishedRuns });
    const { result } = renderHook(() => useRuns(api, openFake));
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    act(() => result.current.history.loadMore());
    act(() => result.current.history.loadMore()); // one at a time
    await waitFor(() => expect(result.current.history.loading).toBe(false));
    expect(finishedRuns).toHaveBeenCalledTimes(1);
    expect(finishedRuns).toHaveBeenLastCalledWith(undefined, undefined);
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(result.current.history.done).toBe(true));
    expect(finishedRuns).toHaveBeenLastCalledWith('c1', undefined);
    expect(result.current.runs.map((run) => run.id).sort()).toEqual(['a', 'b', 'c', 'run1']);
    act(() => result.current.history.loadMore());
    expect(finishedRuns).toHaveBeenCalledTimes(2);
  });

  it('follows run events, survives a new snapshot and retries the same cursor after an error', async () => {
    const finishedRuns = vi
      .fn()
      .mockResolvedValueOnce({ runs: [done('z')], next: 'c1' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ runs: [done('a')], next: null });
    const api = fakeApi({ finishedRuns });
    const { result } = renderHook(() => useRuns(api, openFake));
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(result.current.runs.map((run) => run.id)).toContain('z'));
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(result.current.history.error).toBe('boom'));
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(result.current.history.done).toBe(true));
    expect(result.current.history.error).toBeNull();
    expect(finishedRuns).toHaveBeenNthCalledWith(2, 'c1', undefined);
    expect(finishedRuns).toHaveBeenNthCalledWith(3, 'c1', undefined);
    act(() => stream().send({ event: 'run', run: { ...done('a'), title: 'новое' } }));
    expect(result.current.runs.find((run) => run.id === 'a')?.title).toBe('новое');
    act(() => stream().send({ event: 'snapshot', seq: 2, runs: [runView()] }));
    expect(result.current.runs.find((run) => run.id === 'a')?.title).toBe('новое');
  });
});

describe('first state of the runs', () => {
  it('is loaded by the snapshot, not by an earlier daemon event', () => {
    const api = fakeApi();
    const { result } = renderHook(() => useRuns(api, openFake));
    act(() => stream().send({ event: 'daemon', daemon: null }));
    expect(result.current.loaded).toBe(false);
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    expect(result.current.loaded).toBe(true);
  });

  it('lists only the runs of the snapshot and of run events as live', async () => {
    const finishedRuns = vi.fn().mockResolvedValueOnce({ runs: [done('a')], next: null });
    const api = fakeApi({ finishedRuns });
    const { result } = renderHook(() => useRuns(api, openFake));
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(result.current.runs.map((run) => run.id)).toContain('a'));
    expect([...result.current.listedRuns]).toEqual(['run1']);
  });

  it('keeps a hidden item hidden when a snapshot lacks its run and a page brings it back', async () => {
    window.localStorage.clear();
    const old = runView({
      id: 'old',
      finished: true,
      state: 'finished',
      groups: [groupRow({ slug: 'f', title: 'f', status: 'failed', reason: 'boom' })],
    });
    const finishedRuns = vi.fn().mockResolvedValueOnce({ runs: [old], next: null });
    const api = fakeApi({ finishedRuns });
    const created: unknown[] = [];
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted';
        constructor(...args: unknown[]) {
          created.push(args);
        }
      },
    );
    const { result } = renderHook(() => {
      const state = useRuns(api, openFake);
      const center = useNotificationCenter(
        state.runs,
        () => undefined,
        state.loaded,
        state.listedRuns,
      );
      return { state, center };
    });
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [old] }));
    act(() => result.current.center.hide('old/f/failed'));
    // after a reload the snapshot lacks the old run
    act(() => stream().send({ event: 'snapshot', seq: 2, runs: [runView()] }));
    expect(window.localStorage.getItem('aip.web.notificationsHidden')).toBe('["old/f/failed"]');
    act(() => result.current.state.history.loadMore());
    await waitFor(() => expect(result.current.state.runs.map((run) => run.id)).toContain('old'));
    expect(result.current.center.items).toEqual([]);
    expect(result.current.center.unread).toBe(0);
    expect(created).toEqual([]);
  });

  it('keeps the marks and stays silent when a daemon event precedes the snapshot', () => {
    window.localStorage.clear();
    window.localStorage.setItem('aip.web.notificationsHidden', '["old/f/failed"]');
    const created: unknown[] = [];
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted';
        constructor(...args: unknown[]) {
          created.push(args);
        }
      },
    );
    const api = fakeApi();
    const { result } = renderHook(() => {
      const state = useRuns(api, openFake);
      const center = useNotificationCenter(
        state.runs,
        () => undefined,
        state.loaded,
        state.listedRuns,
      );
      return { state, center };
    });
    act(() => stream().send({ event: 'daemon', daemon: null }));
    const old = runView({
      id: 'old',
      groups: [groupRow({ slug: 'f', title: 'f', status: 'failed', reason: 'boom' })],
    });
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [old] }));
    expect(window.localStorage.getItem('aip.web.notificationsHidden')).toBe('["old/f/failed"]');
    expect(result.current.center.items).toEqual([]);
    expect(created).toEqual([]);
  });
});

type Callback = (entries: { isIntersecting: boolean }[]) => void;

describe('useNearEnd and the list end', () => {
  let callback: Callback = () => undefined;
  let options: IntersectionObserverInit | undefined;
  class FakeObserver {
    constructor(cb: Callback, init?: IntersectionObserverInit) {
      callback = cb;
      options = init;
    }
    observe() {}
    disconnect() {}
  }

  function Probe({ element, onReach }: { element: Element | null; onReach: () => void }) {
    useNearEnd(element, onReach);
    return null;
  }

  it('calls back only while the element is in view, with a 200px margin', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const onReach = vi.fn();
    render(<Probe element={document.createElement('div')} onReach={onReach} />);
    expect(options?.rootMargin).toBe('200px');
    act(() => callback([{ isIntersecting: false }]));
    expect(onReach).not.toHaveBeenCalled();
    act(() => callback([{ isIntersecting: true }]));
    expect(onReach).toHaveBeenCalledTimes(1);
  });

  it('uses the scrolling container as the root when there is one', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const aside = document.createElement('aside');
    aside.style.overflowY = 'auto';
    const inner = document.createElement('div');
    aside.append(inner);
    document.body.append(aside);
    render(<Probe element={inner} onReach={vi.fn()} />);
    expect(options?.root).toBe(aside);
    cleanup();
    render(<Probe element={document.createElement('div')} onReach={vi.fn()} />);
    expect(options?.root).toBeNull();
    aside.remove();
  });

  it('does nothing without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onReach = vi.fn();
    render(<Probe element={document.createElement('div')} onReach={onReach} />);
    expect(onReach).not.toHaveBeenCalled();
  });

  function list(more: 'idle' | 'loading' | 'error' | 'done', runs = [done('a')], onMore = vi.fn()) {
    render(
      <TagsProvider tags={[]}>
        <RunList
          runs={runs}
          selectedRun={null}
          selectedGroup={null}
          now={2_000}
          query="zzz"
          onQuery={() => undefined}
          filters={EMPTY_FILTERS}
          onFilters={() => undefined}
          onSelect={() => undefined}
          scope="all"
          onScope={() => undefined}
          repository="/repo"
          more={more}
          onMore={onMore}
        />
      </TagsProvider>,
    );
    return onMore;
  }

  it('asks for a page when the end marker is in view, instead of "nothing found"', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const onMore = list('idle');
    expect(screen.queryByText('Nothing found')).toBeNull();
    act(() => callback([{ isIntersecting: true }]));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('shows a loading status only while a page is loading', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    list('loading');
    expect(screen.getByRole('status', { name: 'Loading older runs…' })).toBeTruthy();
    expect(screen.queryByText('Nothing found')).toBeNull();
    cleanup();
    list('idle');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows "nothing found" once the pages are over', () => {
    list('done');
    expect(screen.getByText('Nothing found')).toBeTruthy();
  });

  it('shows the error with a retry button', () => {
    const onMore = list('error');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});

describe('search through old runs', () => {
  it('keeps loading pages until the searched run arrives', async () => {
    window.location.hash = '';
    class Visible {
      constructor(private cb: Callback) {}
      observe() {
        setTimeout(() => this.cb([{ isIntersecting: true }]), 0);
      }
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Visible);
    const finishedRuns = vi
      .fn()
      .mockResolvedValueOnce({ runs: [done('p1')], next: 'c1' })
      .mockResolvedValueOnce({ runs: [done('p2')], next: 'c2' })
      .mockResolvedValueOnce({
        runs: [runView({ id: 'old', title: 'Старая задача', finished: true, state: 'finished' })],
        next: null,
      });
    const api = fakeApi({ finishedRuns });
    render(<App api={api} openStream={openFake} />);
    act(() => {
      stream().open();
      stream().send({
        event: 'snapshot',
        seq: 1,
        runs: [runView()],
        repositories: [project('/repo')],
      });
    });
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search runs' }), {
      target: { value: 'Старая' },
    });
    await waitFor(() => expect(document.querySelector('li[data-run="old"]')).toBeTruthy());
    expect(finishedRuns).toHaveBeenCalledTimes(3);
    expect(finishedRuns).toHaveBeenNthCalledWith(3, 'c2', '/repo');
    expect(screen.queryByText('Nothing found')).toBeNull();
  });
});

describe('history per repository', () => {
  const registry = [project('/work/app'), project('/work/lib')];
  const open = () =>
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [], repositories: registry }));
  const hook = (api: ReturnType<typeof fakeApi>) =>
    renderHook(
      ({ wanted, byRepository }: { wanted: string | null; byRepository: boolean }) =>
        useRuns(api, openFake, wanted, null, () => undefined, byRepository),
      { initialProps: { wanted: '/work/app' as string | null, byRepository: true } },
    );

  it('asks for the pages of the selected repository', async () => {
    const finishedRuns = vi.fn().mockResolvedValue({ runs: [done('a')], next: null });
    const { result } = hook(fakeApi({ finishedRuns }));
    open();
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(result.current.history.done).toBe(true));
    expect(finishedRuns).toHaveBeenCalledWith(undefined, '/work/app');
  });

  it('keeps a cursor per repository and the runs loaded before a switch', async () => {
    const finishedRuns = vi.fn(async (before?: string, repository?: string) =>
      repository === '/work/lib'
        ? { runs: [done('l1')], next: 'lc' }
        : { runs: [done(before ? 'a2' : 'a1')], next: before ? null : 'ac' },
    );
    const { result, rerender } = hook(fakeApi({ finishedRuns }));
    open();
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(result.current.runs.map((run) => run.id)).toContain('a1'));
    rerender({ wanted: '/work/lib', byRepository: true });
    expect(result.current.history.done).toBe(false);
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(result.current.runs.map((run) => run.id)).toContain('l1'));
    expect(finishedRuns).toHaveBeenLastCalledWith(undefined, '/work/lib');
    expect(result.current.runs.map((run) => run.id)).toContain('a1');
    rerender({ wanted: '/work/app', byRepository: true });
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(result.current.history.done).toBe(true));
    expect(finishedRuns).toHaveBeenLastCalledWith('ac', '/work/app');
  });

  it('ignores the cursor of an answer that arrives after a switch', async () => {
    let release: (page: { runs: RunView[]; next: string | null }) => void = () => undefined;
    const finishedRuns = vi.fn(
      (_before?: string, repository?: string) =>
        new Promise<{ runs: RunView[]; next: string | null }>((resolve) => {
          if (repository === '/work/app') release = resolve;
          else resolve({ runs: [], next: 'lc' });
        }),
    );
    const { result, rerender } = hook(fakeApi({ finishedRuns }));
    open();
    act(() => result.current.history.loadMore());
    rerender({ wanted: '/work/lib', byRepository: true });
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(finishedRuns).toHaveBeenCalledTimes(2));
    await act(async () => release({ runs: [done('a')], next: null }));
    expect(result.current.history.done).toBe(false);
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(finishedRuns).toHaveBeenLastCalledWith('lc', '/work/lib'));
  });

  it('asks without a repository when the list is of all repositories', async () => {
    const finishedRuns = vi.fn().mockResolvedValue({ runs: [], next: null });
    const { result: all } = renderHook(() =>
      useRuns(fakeApi({ finishedRuns }), openFake, null, null, () => undefined, false),
    );
    act(() => all.current.history.loadMore());
    expect(finishedRuns).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it('opens the list of a project with one request', async () => {
    window.location.hash = '';
    window.localStorage.clear();
    // The end marker is in view only while the project has fewer than 50 runs listed.
    class Marker {
      constructor(private cb: Callback) {}
      observe() {
        setTimeout(() => {
          if (document.querySelectorAll('li[data-run]').length < 50) {
            this.cb([{ isIntersecting: true }]);
          }
        }, 0);
      }
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Marker);
    const page = Array.from({ length: 50 }, (_, index) => done(`p${index}`));
    const finishedRuns = vi.fn().mockResolvedValue({ runs: page, next: 'c1' });
    const api = fakeApi({ finishedRuns });
    render(<App api={api} openStream={openFake} />);
    act(() => {
      stream().open();
      stream().send({
        event: 'snapshot',
        seq: 1,
        runs: [runView()],
        repositories: [project('/repo')],
      });
    });
    await waitFor(() => expect(finishedRuns).toHaveBeenCalledTimes(1));
    expect(finishedRuns).toHaveBeenCalledWith(undefined, '/repo');
    await waitFor(() =>
      expect(document.querySelectorAll('li[data-run]').length).toBeGreaterThanOrEqual(50),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finishedRuns).toHaveBeenCalledTimes(1);
  });

  it('loads the first page once the project is known, when the snapshot comes first', async () => {
    window.location.hash = '';
    window.localStorage.clear();
    class Visible {
      constructor(private cb: Callback) {}
      observe() {
        setTimeout(() => this.cb([{ isIntersecting: true }]), 0);
      }
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Visible);
    let release: (value: ReturnType<typeof queueOf>) => void = () => undefined;
    const queue = vi.fn(
      () =>
        new Promise<ReturnType<typeof queueOf>>((resolve) => {
          release = resolve;
        }),
    );
    const finishedRuns = vi.fn().mockResolvedValue({ runs: [], next: null });
    render(<App api={fakeApi({ finishedRuns, queue })} openStream={openFake} />);
    act(() => {
      stream().open();
      stream().send({
        event: 'snapshot',
        seq: 1,
        runs: [runView()],
        repositories: [project('/repo')],
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finishedRuns).not.toHaveBeenCalled();
    await act(async () => release(queueOf()));
    await waitFor(() => expect(finishedRuns).toHaveBeenCalledTimes(1));
    expect(finishedRuns).toHaveBeenCalledWith(undefined, '/repo');
  });

  it('asks again when the list changes while the end marker stays in view', async () => {
    class Visible {
      constructor(private cb: Callback) {}
      observe() {
        this.cb([{ isIntersecting: true }]);
      }
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Visible);
    const onMore = vi.fn();
    const list = (repository: string) => (
      <TagsProvider tags={[]}>
        <RunList
          runs={[done('a')]}
          selectedRun={null}
          selectedGroup={null}
          now={2_000}
          query=""
          onQuery={() => undefined}
          filters={EMPTY_FILTERS}
          onFilters={() => undefined}
          onSelect={() => undefined}
          scope="repository"
          onScope={() => undefined}
          repository={repository}
          more="idle"
          onMore={onMore}
        />
      </TagsProvider>
    );
    const { rerender } = render(list('/one'));
    await waitFor(() => expect(onMore).toHaveBeenCalledTimes(1));
    rerender(list('/two'));
    await waitFor(() => expect(onMore).toHaveBeenCalledTimes(2));
  });
});
