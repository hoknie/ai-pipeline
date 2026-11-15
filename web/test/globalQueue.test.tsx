// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { applyEvent } from '../src/shared/api/runs/streamEvents.ts';
import type { Api } from '../src/shared/api/api.ts';
import type { GlobalQueueItemView, GlobalQueueView } from '../src/shared/api/types.ts';

import {
  FakeEventSource,
  fakeApi,
  openFake,
  queueItem,
  queueRun,
  queueOf,
  repositoryView,
  runView,
} from './fixtures.ts';

const APP = '/work/app';
const LIB = '/work/lib';

beforeEach(() => {
  window.location.hash = '#queue';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function globalItem(id: string, task: string, position: number, repository: string) {
  return { ...queueItem(id, task, position), repository } as GlobalQueueItemView;
}

function globalOf(overrides: Partial<GlobalQueueView> = {}): GlobalQueueView {
  const { repository: _repository, autoDeliver: _a, deliveryMode: _d, ...rest } = queueOf();
  return {
    ...rest,
    scope: 'global',
    filter: { pipelines: [], projects: [] },
    filterTags: undefined,
    max: 4,
    items: [globalItem('qa', 'task of app', 1, APP), globalItem('ql', 'task of lib', 2, LIB)],
    ...overrides,
  } as unknown as GlobalQueueView;
}

function mount(globalQueue: GlobalQueueView | null, api: Partial<Api> = {}) {
  const fake = fakeApi({ queue: vi.fn(async () => queueOf({ repository: APP })), ...api });
  render(<App api={fake as Api} openStream={openFake} />);
  act(() => {
    FakeEventSource.last?.send({
      event: 'snapshot',
      seq: 1,
      runs: [runView({ id: 'a1', repository: APP })],
      queues: globalQueue ? [] : [queueOf({ repository: APP })],
      ...(globalQueue ? { globalQueue } : {}),
      repositories: [repositoryView(APP), repositoryView(LIB)],
    });
  });
  return fake;
}

describe('page of the global queue', () => {
  it('shows the badge, the limit and the tasks of all projects with their projects', async () => {
    mount(globalOf());
    expect(await screen.findByText('Global queue')).toBeTruthy();
    expect(screen.getByText(/At most 4 specialists/)).toBeTruthy();
    const items = within(await screen.findByRole('list', { name: /tasks|queue/i }));
    const rows = items.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-id'))).toEqual(['qa', 'ql']);
    expect(rows[0]!.querySelector(`[data-project="${APP}"]`)).not.toBeNull();
    expect(rows[1]!.querySelector(`[data-project="${LIB}"]`)).not.toBeNull();
  });

  it('shows the runs with their projects', async () => {
    mount(
      globalOf({
        runs: [
          { ...queueRun('r1', { title: 'lib run' }), repository: LIB },
        ] as GlobalQueueView['runs'],
      }),
    );
    const section = await screen.findByRole('region', { name: /Running from the queue/i });
    expect(within(section).getByText('lib run')).toBeTruthy();
    expect(section.querySelector(`[data-project="${LIB}"]`)).not.toBeNull();
  });

  it('moves a task by its place among all projects through the project of the task', async () => {
    const edit = vi.fn(async () => queueOf());
    const api = mount(globalOf(), { queueEdit: edit });
    const first = await screen.findByLabelText(/^1\. /);
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(edit).toHaveBeenCalledWith('qa', { position: 2 }));
    expect(api.calls).toContainEqual(['queueEdit', APP]);
  });

  it('sets the filter of projects only while the queue is stopped', async () => {
    const settings = vi.fn(async () => queueOf());
    mount(globalOf({ status: 'running' }), { queueSettings: settings });
    const block = within(await screen.findByRole('region', { name: 'Projects' }));
    expect(block.getByText(/Stop the queue to change the filter/)).toBeTruthy();
    expect(settings).not.toHaveBeenCalled();
  });

  it('starts and pauses the one queue', async () => {
    const start = vi.fn(async () => queueOf());
    mount(globalOf(), { queueStart: start });
    const button = await screen.findByRole('button', { name: 'Start' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(start).toHaveBeenCalled());
  });

  it('takes the next global queue from the event', async () => {
    mount(globalOf());
    await screen.findByText('Global queue');
    act(() => {
      FakeEventSource.last?.send({
        event: 'globalQueue',
        seq: 2,
        globalQueue: globalOf({ items: [globalItem('qz', 'new one', 1, LIB)] }),
      });
    });
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('li[data-id]')].map((row) => row.getAttribute('data-id')),
      ).toEqual(['qz']),
    );
  });

  it('counts the tasks of the global queue in the counter of the section', async () => {
    mount(globalOf());
    await screen.findByText('Global queue');
    expect(screen.getAllByLabelText('in the queue: 2').length).toBeGreaterThan(0);
  });
});

describe('events of the global queue', () => {
  const setters = () => {
    const state: { value: GlobalQueueView | null } = { value: null };
    const set = {
      setGlobalQueue: (next: GlobalQueueView | null | ((c: GlobalQueueView | null) => unknown)) => {
        state.value = (typeof next === 'function' ? next(state.value) : next) as never;
      },
      setQueues: () => undefined,
      setDaemon: () => undefined,
      setLoaded: () => undefined,
      setRuns: () => undefined,
      setTags: () => undefined,
      setRegistry: () => undefined,
    };
    return { state, set: set as unknown as Parameters<typeof applyEvent>[1] };
  };

  it('keeps the global queue of an event and drops it on null and in a snapshot without it', () => {
    const { state, set } = setters();
    const view = globalOf();
    applyEvent({ event: 'globalQueue', globalQueue: view } as never, set, () => undefined);
    expect(state.value).toEqual(view);
    applyEvent({ event: 'globalQueue', globalQueue: null } as never, set, () => undefined);
    expect(state.value).toBeNull();
    applyEvent({ event: 'globalQueue', globalQueue: view } as never, set, () => undefined);
    applyEvent({ event: 'snapshot', runs: [] } as never, set, () => undefined);
    expect(state.value).toBeNull();
  });
});
