// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from './render.tsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { ApiError } from '../src/shared/api/api.ts';
import { useRuns } from '../src/shared/api/runs/useRuns.ts';

import {
  FakeEventSource,
  fakeApi,
  groupRow,
  openFake,
  queueOf,
  queueRun,
  runView,
} from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
});

const stream = () => FakeEventSource.last!;
const old = () => runView({ id: 'old', title: 'Старый запуск', finished: true, state: 'finished' });

describe('a run missing from the list', () => {
  it('is fetched once by id and joins the list', async () => {
    const api = fakeApi({ run: vi.fn(async () => old()) });
    const { result } = renderHook(() => useRuns(api, openFake, null, 'old'));
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    await waitFor(() => expect(result.current.runs.map((run) => run.id)).toContain('old'));
    expect(api.run).toHaveBeenCalledTimes(1);
    expect(api.run).toHaveBeenCalledWith('old');
    expect(result.current.openedState).toBe('listed');
  });

  it('is not fetched before the list is loaded, and is not when the list has it', () => {
    const api = fakeApi({ run: vi.fn(async () => old()) });
    renderHook(() => useRuns(api, openFake, null, 'run1'));
    expect(api.run).not.toHaveBeenCalled();
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    expect(api.run).not.toHaveBeenCalled();
  });

  it('stays after a new snapshot without it and follows run events', async () => {
    const api = fakeApi({ run: vi.fn(async () => old()) });
    const { result } = renderHook(() => useRuns(api, openFake, null, 'old'));
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    await waitFor(() => expect(result.current.runs).toHaveLength(2));
    act(() => stream().send({ event: 'snapshot', seq: 2, runs: [runView()] }));
    expect(result.current.runs.map((run) => run.id)).toContain('old');
    act(() => stream().send({ event: 'run', seq: 3, run: { ...old(), title: 'Новое имя' } }));
    expect(result.current.runs.find((run) => run.id === 'old')?.title).toBe('Новое имя');
  });

  it('reports an unknown id as missing and does not ask again', async () => {
    const api = fakeApi();
    const { result, rerender } = renderHook(() => useRuns(api, openFake, null, 'nope'));
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    await waitFor(() => expect(result.current.openedState).toBe('missing'));
    act(() => stream().send({ event: 'snapshot', seq: 2, runs: [runView()] }));
    rerender();
    expect(api.run).toHaveBeenCalledTimes(1);
  });

  it('passes another failure to onError', async () => {
    const api = fakeApi({
      run: vi.fn(async () => {
        throw new ApiError(500, 'boom');
      }),
    });
    const onError = vi.fn();
    renderHook(() => useRuns(api, openFake, null, 'old', onError));
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('boom'));
  });
});

describe('the panel', () => {
  it('opens a group of a run outside the snapshot from the address', async () => {
    window.location.hash = '#runs/old/login';
    const api = fakeApi({
      run: vi.fn(async () =>
        runView({ id: 'old', title: 'Старый запуск', groups: [groupRow({ slug: 'login' })] }),
      ),
    });
    render(<App api={api} openStream={openFake} />);
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    expect((await screen.findAllByText('Старый запуск')).length).toBeGreaterThan(0);
    expect(api.group).toHaveBeenCalledWith('old', 'login');
  });

  it('shows "Run not found" for an unknown id', async () => {
    window.location.hash = '#runs/nope';
    render(<App api={fakeApi()} openStream={openFake} />);
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    expect(await screen.findByText('Run not found')).toBeTruthy();
    expect(screen.getByText('nope')).toBeTruthy();
  });

  it('opens a skipped run from the queue', async () => {
    window.location.hash = '#queue';
    const api = fakeApi({
      queue: vi.fn(async () =>
        queueOf({
          skipped: [queueRun('old', { title: 'Старый запуск', state: 'failed' })],
        }),
      ),
      run: vi.fn(async () => old()),
    });
    render(<App api={api} openStream={openFake} />);
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    const region = within(await screen.findByRole('region', { name: 'skipped with a problem' }));
    fireEvent.click(region.getByRole('link', { name: /Старый запуск|old/ }));
    await waitFor(() => expect(api.run).toHaveBeenCalledWith('old'));
    expect(await screen.findByRole('heading', { name: /Старый запуск/ })).toBeTruthy();
  });
});
