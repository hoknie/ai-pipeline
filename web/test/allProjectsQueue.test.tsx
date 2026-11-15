// @vitest-environment jsdom
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import type { Api } from '../src/shared/api/api.ts';
import type { QueueView } from '../src/shared/api/types.ts';

import {
  FakeEventSource,
  fakeApi,
  openFake,
  queueItem,
  queueOf,
  repositoryView,
  runView,
} from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

const APP = '/work/app';
const LIB = '/work/lib';
const WEB = '/work/web';

beforeEach(() => {
  window.location.hash = '#queue';
  window.localStorage.clear();
  window.localStorage.setItem('aip.web.projects.all', 'true');
  window.localStorage.setItem('aip.web.repository', JSON.stringify(APP));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Calls = [string, string | null][];

/** A panel over three projects; `overrides` replace the requests of one repository. */
function mount(
  queues: QueueView[],
  overrides: Partial<Record<string, Partial<Api>>> = {},
  runs = [runView({ id: 'a1', repository: APP })],
) {
  const base = fakeApi({ runs: vi.fn(async () => []) });
  const bound = (repository: string | null): Api => ({
    ...base.forRepository(repository),
    ...(repository === null ? {} : (overrides[repository] ?? {})),
    forRepository: bound,
  });
  const api = { ...base, forRepository: bound } as Api;
  render(<App api={api} openStream={openFake} />);
  act(() => {
    FakeEventSource.last?.send({
      event: 'snapshot',
      seq: 1,
      runs,
      queues,
      repositories: [repositoryView(APP), repositoryView(LIB), repositoryView(WEB)],
    });
  });
  return { base, calls: (base as unknown as { calls: Calls }).calls };
}

const block = (name: string) => screen.findByRole('region', { name: `Queue of ${name}` });

describe('queue in the mode «All projects»', () => {
  it('shows links to another project in its queue block', async () => {
    mount([
      queueOf({
        repository: APP,
        items: [
          queueItem('a1', 'app task', 1, {
            readiness: 'waiting',
            links: [
              {
                kind: 'blocked_by',
                id: 'l1',
                ref: 'item',
                number: 7,
                title: 'lib task',
                repository: LIB,
                state: 'waiting',
              },
            ],
          }),
        ],
      }),
      queueOf({ repository: LIB, items: [queueItem('l1', 'lib task', 7)] }),
    ]);
    const app = await block('app');
    const row = within(app).getByRole('listitem', { name: /app task/ });
    expect(within(row).getByText('Blocked by:')).toBeTruthy();
    expect(within(row).getByText('lib')).toBeTruthy();
    expect(within(row).getByText('#7 lib task')).toBeTruthy();
  });
  it('shows a block per project with its state and tasks, ordered by name', async () => {
    mount([
      queueOf({
        repository: LIB,
        items: [queueItem('l1', 'lib task', 1)],
      }),
      queueOf({
        repository: APP,
        status: 'running',
        items: [queueItem('a1', 'first', 1), queueItem('a2', 'second', 2)],
      }),
    ]);
    const app = await block('app');
    const lib = await block('lib');
    expect(app.compareDocumentPosition(lib) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(app).getByText('Running')).toBeTruthy();
    expect(within(app).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
    expect(within(lib).getByText('Stopped')).toBeTruthy();
    expect(within(lib).getByText('lib task')).toBeTruthy();
  });

  it('collapses empty queues into one line', async () => {
    mount([
      queueOf({ repository: APP, items: [queueItem('a1', 'app task', 1)] }),
      queueOf({ repository: LIB }),
    ]);
    await block('app');
    expect(screen.queryByRole('region', { name: 'Queue of lib' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Queue of web' })).toBeNull();
    const line = document.querySelector('[data-empty-queues]')!;
    expect(line.textContent).toBe('Empty queues: lib, web');
  });

  it('starts only the queue of the block', async () => {
    const { calls } = mount([
      queueOf({ repository: APP, items: [queueItem('a1', 'app task', 1)] }),
      queueOf({ repository: LIB, items: [queueItem('l1', 'lib task', 1)] }),
    ]);
    const lib = await block('lib');
    fireEvent.click(within(lib).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(calls).toContainEqual(['queueStart', LIB]));
    expect(calls).not.toContainEqual(['queueStart', APP]);
  });

  it('edits a task through the queue of its own project', async () => {
    const { calls } = mount([
      queueOf({ repository: APP, items: [queueItem('a1', 'app task', 1)] }),
      queueOf({
        repository: LIB,
        items: [queueItem('l1', 'first', 1), queueItem('l2', 'second', 2)],
      }),
    ]);
    const lib = await block('lib');
    const rows = within(lib).getAllByRole('listitem');
    const transfer = { setData: vi.fn(), getData: () => '', effectAllowed: '' };
    fireEvent.dragStart(rows[1]!, { dataTransfer: transfer });
    fireEvent.dragOver(rows[0]!, { dataTransfer: transfer, clientY: -1 });
    fireEvent.drop(rows[0]!, { dataTransfer: transfer, clientY: -1 });
    await waitFor(() => expect(calls).toContainEqual(['queueEdit', LIB]));
    expect(calls).not.toContainEqual(['queueEdit', APP]);
  });

  it('does not take a task dropped on the block of another project', async () => {
    const { calls } = mount([
      queueOf({ repository: APP, items: [queueItem('a1', 'app task', 1)] }),
      queueOf({ repository: LIB, items: [queueItem('l1', 'lib task', 1)] }),
    ]);
    const app = await block('app');
    const lib = await block('lib');
    const from = within(app).getAllByRole('listitem')[0]!;
    const to = within(lib).getAllByRole('listitem')[0]!;
    const transfer = { setData: vi.fn(), getData: () => 'a1', effectAllowed: '' };
    fireEvent.dragStart(from, { dataTransfer: transfer });
    fireEvent.dragOver(to, { dataTransfer: transfer, clientY: -1 });
    fireEvent.drop(to, { dataTransfer: transfer, clientY: -1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.filter(([name]) => name === 'queueEdit')).toEqual([]);
  });

  it('opens the queue of a project and leaves the mode', async () => {
    mount([
      queueOf({ repository: APP, items: [queueItem('a1', 'app task', 1)] }),
      queueOf({ repository: LIB, items: [queueItem('l1', 'lib task', 1)] }),
    ]);
    const lib = await block('lib');
    fireEvent.click(within(lib).getByRole('button', { name: 'Open the project queue' }));
    await waitFor(() =>
      expect(document.querySelector('[data-repository-trigger]')!.getAttribute('aria-label')).toBe(
        'Repository: lib',
      ),
    );
    expect(window.localStorage.getItem('aip.web.projects.all')).toBe('false');
    expect(window.location.hash).toBe('#queue');
  });
});

describe('the common buttons', () => {
  const tasks = (repository: string, status: 'stopped' | 'running' = 'stopped', count = 1) =>
    queueOf({
      repository,
      status,
      items: Array.from({ length: count }, (_, index) =>
        queueItem(`${repository}${index}`, 'task', index + 1),
      ),
    });

  it('start every stopped queue with tasks and leave the empty one', async () => {
    const { calls } = mount([tasks(APP), tasks(LIB), queueOf({ repository: WEB })]);
    await block('app');
    fireEvent.click(screen.getByRole('button', { name: 'Start all' }));
    await waitFor(() => {
      expect(calls).toContainEqual(['queueStart', APP]);
      expect(calls).toContainEqual(['queueStart', LIB]);
    });
    expect(calls).not.toContainEqual(['queueStart', WEB]);
  });

  it('pause every running queue', async () => {
    const { calls } = mount([tasks(APP, 'running'), tasks(LIB, 'running')]);
    await block('app');
    fireEvent.click(screen.getByRole('button', { name: 'Pause all' }));
    await waitFor(() => {
      expect(calls).toContainEqual(['queuePause', APP]);
      expect(calls).toContainEqual(['queuePause', LIB]);
    });
  });

  it('are disabled when there is nothing to change', async () => {
    mount([tasks(APP, 'running'), queueOf({ repository: LIB })]);
    await block('app');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start all' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pause all' }).disabled).toBe(
      false,
    );
  });

  it('keep going when one queue refuses, and name the project and the reason', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 1);
    const { calls } = mount([tasks(APP), tasks(LIB)], {
      [LIB]: {
        queueStart: vi.fn(async () => {
          throw new Error('daemon said no');
        }),
      },
    });
    await block('app');
    fireEvent.click(screen.getByRole('button', { name: 'Start all' }));
    await waitFor(() => expect(calls).toContainEqual(['queueStart', APP]));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('lib: daemon said no'),
        expect.anything(),
      ),
    );
  });
});
