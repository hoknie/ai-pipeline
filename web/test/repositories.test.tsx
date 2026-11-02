// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import type { Api } from '../src/api.ts';
import { httpApi, withRepository } from '../src/api.ts';
import type { RepositoryView } from '../src/types.ts';
import { repositoryLabel, repositoryList, waitingByRepository } from '../src/repositories.ts';

import {
  FakeEventSource,
  configView,
  fakeApi,
  groupRow,
  openFake,
  queueItem,
  queueOf,
  runView,
  specialistEntry,
  workflowsView,
} from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const APP = '/work/app';
const LIB = '/work/lib';

function entry(path: string, waiting = 0): RepositoryView {
  return { path, addedAt: 1, unfinished: waiting, waiting, queued: 0 };
}

describe('repositoryList, waitingByRepository, repositoryLabel', () => {
  const registry = [
    entry('/work/zeta'),
    entry(LIB, 2),
    entry(APP),
    entry('/work/beta'),
    entry('/work/home'),
  ];

  it('lists each repository once, home first, the rest by directory name', () => {
    expect(repositoryList('/work/home', registry)).toEqual([
      '/work/home',
      APP,
      '/work/beta',
      LIB,
      '/work/zeta',
    ]);
    expect(repositoryList(LIB, [entry(APP)])).toEqual([LIB, APP]);
    expect(repositoryList(null, [])).toEqual([]);
  });

  it('counts the runs waiting for an answer per repository', () => {
    expect(waitingByRepository(registry)).toEqual(new Map([[LIB, 2]]));
  });

  it('labels a path with its directory name', () => {
    expect(repositoryLabel(APP)).toBe('app');
    expect(repositoryLabel('/work/app/')).toBe('app');
    expect(repositoryLabel('/')).toBe('/');
  });
});

describe('Api.forRepository', () => {
  it('adds the repository to the address, after an existing query with &', () => {
    expect(withRepository('/api/queue', null)).toBe('/api/queue');
    expect(withRepository('/api/queue', LIB)).toBe('/api/queue?repository=%2Fwork%2Flib');
    expect(withRepository('/api/config/specialists/a?revision=r1', LIB)).toBe(
      '/api/config/specialists/a?revision=r1&repository=%2Fwork%2Flib',
    );
  });

  it('sends queue, config, workflow and delete requests with the repository', async () => {
    const fetched: { url: string; method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        fetched.push({ url, method: init?.method ?? 'GET' });
        return new Response('{}', { status: 200 });
      }),
    );
    try {
      expect(httpApi.forRepository(null)).toBe(httpApi);
      const api = httpApi.forRepository(LIB);
      await api.queue();
      await api.queuePause();
      await api.config();
      await api.workflows();
      await api.deleteSpecialist('coder', 'r1');
      await httpApi.queue();
      const repository = 'repository=%2Fwork%2Flib';
      expect(fetched).toEqual([
        { url: `/api/queue?${repository}`, method: 'GET' },
        { url: `/api/queue/pause?${repository}`, method: 'POST' },
        { url: `/api/config?${repository}`, method: 'GET' },
        { url: `/api/workflows?${repository}`, method: 'GET' },
        {
          url: `/api/config/specialists/coder?revision=r1&${repository}`,
          method: 'DELETE',
        },
        { url: '/api/queue', method: 'GET' },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/** An api for a panel started in /work/app that knows runs and queues of /work/lib too. */
function twoRepositories(overrides: Partial<Api> = {}) {
  const base = fakeApi({
    queue: vi.fn(async () => queueOf({ repository: APP, items: [queueItem('qa', 'app task', 1)] })),
    runs: vi.fn(async () => []),
    ...overrides,
  });
  const perRepository = (repository: string | null): Api => {
    const scoped = base.forRepository(repository);
    const lib = repository === LIB;
    return {
      ...scoped,
      forRepository: perRepository,
      config: async () => {
        await scoped.config();
        return configView({
          repository: lib ? LIB : APP,
          specialists: [specialistEntry(lib ? 'writer' : 'coder')],
        });
      },
      workflows: async () => {
        await scoped.workflows();
        return workflowsView({ repository: lib ? LIB : APP });
      },
    };
  };
  return { base, api: { ...base, forRepository: perRepository } as Api };
}

function snapshot(runs = [runView({ id: 'a1', repository: APP })], extra = {}) {
  const lib = runView({ id: 'l1', repository: LIB, title: 'lib run', groups: [groupRow()] });
  act(() => {
    FakeEventSource.last?.send({
      event: 'snapshot',
      seq: 1,
      runs: [...runs, lib],
      queues: [
        queueOf({ repository: APP, items: [queueItem('qa', 'app task', 1)] }),
        queueOf({
          repository: LIB,
          status: 'running',
          items: [queueItem('ql', 'lib task', 1)],
        }),
      ],
      repositories: [entry(APP), entry(LIB)],
      ...extra,
    });
  });
}

const trigger = () => document.querySelector<HTMLElement>('[data-repository-trigger]')!;

async function openMenu() {
  fireEvent.keyDown(trigger(), { key: 'Enter' });
  return screen.findByRole('menuitemradio', { name: /app/ });
}

describe('repository selector', () => {
  it('opens on the repository of the panel and lists the others with full paths', async () => {
    const { api } = twoRepositories();
    render(<App api={api} openStream={openFake} />);
    snapshot();
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: app'));
    expect(trigger().getAttribute('title')).toBe(APP);
    await openMenu();
    expect(screen.getByRole('menuitemradio', { name: /app/ }).getAttribute('title')).toBe(APP);
    expect(screen.getByRole('menuitemradio', { name: /lib/ }).getAttribute('title')).toBe(LIB);
  });

  it('shows the waiting counter of another repository without a reload', async () => {
    const { api } = twoRepositories();
    render(<App api={api} openStream={openFake} />);
    snapshot();
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: app'));
    act(() =>
      FakeEventSource.last?.send({
        event: 'run',
        seq: 2,
        run: runView({ id: 'l1', repository: LIB, state: 'needs_human', waiting: 1 }),
      }),
    );
    act(() =>
      FakeEventSource.last?.send({
        event: 'repositories',
        seq: 3,
        repositories: [entry(APP), entry(LIB, 1)],
      }),
    );
    await openMenu();
    const item = screen.getByRole('menuitemradio', { name: /lib/ });
    expect(within(item).getByLabelText('waiting for an answer: 1').textContent).toBe('1');
    expect(within(screen.getByRole('menuitemradio', { name: /app/ })).queryByText('1')).toBeNull();
  });

  it('remembers the choice, and falls back to the home repository for an unknown one', async () => {
    const { api } = twoRepositories();
    const first = render(<App api={api} openStream={openFake} />);
    snapshot();
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: app'));
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /lib/ }));
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: lib'));
    expect(window.localStorage.getItem('aip.web.repository')).toBe(JSON.stringify(LIB));
    first.unmount();

    render(<App api={api} openStream={openFake} />);
    snapshot();
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: lib'));
    cleanup();

    window.location.hash = '';
    window.localStorage.setItem('aip.web.repository', JSON.stringify('/work/old'));
    render(<App api={api} openStream={openFake} />);
    snapshot();
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: app'));
  });

  it('shows the queue of the chosen repository and sends requests bound to it', async () => {
    window.location.hash = '#queue';
    const { api, base } = twoRepositories();
    render(<App api={api} openStream={openFake} />);
    snapshot();
    expect(await screen.findByText('app task')).toBeTruthy();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /lib/ }));
    expect(await screen.findByText('lib task')).toBeTruthy();
    expect(screen.queryByText('app task')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(base.queuePause).toHaveBeenCalled());
    expect((base as Api & { calls: [string, string | null][] }).calls).toContainEqual([
      'queuePause',
      LIB,
    ]);
  });

  it('sends requests of the home repository with the repository too', async () => {
    window.location.hash = '#queue';
    const { api, base } = twoRepositories();
    render(<App api={api} openStream={openFake} />);
    snapshot();
    expect(await screen.findByText('app task')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(base.queueStart).toHaveBeenCalled());
    expect((base as Api & { calls: [string, string | null][] }).calls).toContainEqual([
      'queueStart',
      APP,
    ]);
  });

  it('shows the specialists and workflows of the chosen repository', async () => {
    window.location.hash = '#specialists';
    const { api, base } = twoRepositories();
    render(<App api={api} openStream={openFake} />);
    snapshot();
    expect(await screen.findByText('coder')).toBeTruthy();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /lib/ }));
    expect(await screen.findByText('writer')).toBeTruthy();
    expect(screen.queryByText('coder')).toBeNull();
    const calls = (base as Api & { calls: [string, string | null][] }).calls;
    expect(calls).toContainEqual(['config', LIB]);

    fireEvent.click(screen.getByRole('link', { name: 'Workflow' }));
    await waitFor(() => expect(calls).toContainEqual(['config', LIB]));
    fireEvent.click(screen.getByRole('link', { name: 'Topology' }));
    await waitFor(() => expect(calls).toContainEqual(['workflows', LIB]));
  });

  it('asks before switching away from a form with unsaved edits', async () => {
    window.location.hash = '#specialists/coder';
    const { api } = twoRepositories();
    render(<App api={api} openStream={openFake} />);
    snapshot();
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'opus' } });
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /lib/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(trigger().getAttribute('aria-label')).toBe('Repository: app');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('opus');

    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /lib/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: lib'));
  });

  it('selects the repository of a run opened by address', async () => {
    window.location.hash = '#runs/l1';
    const { api } = twoRepositories();
    render(<App api={api} openStream={openFake} />);
    snapshot();
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: lib'));
  });

  it('opens the topology of a run of another repository in that repository', async () => {
    const { api, base } = twoRepositories();
    render(<App api={api} openStream={openFake} />);
    snapshot();
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: app'));
    fireEvent.click(screen.getByRole('radio', { name: 'All repositories' }));
    fireEvent.click(await screen.findByText('lib run'));
    fireEvent.click(screen.getByRole('link', { name: 'Topology' }));
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: lib'));
    await waitFor(() =>
      expect((base as Api & { calls: [string, string | null][] }).calls).toContainEqual([
        'workflows',
        LIB,
      ]),
    );
  });
});

describe('run list scope', () => {
  const mixed = () => [
    runView({ id: 'a1', repository: APP, title: 'app one' }),
    runView({ id: 'a2', repository: APP, title: 'app two' }),
    runView({ id: 'l2', repository: LIB, title: 'lib waits', state: 'needs_human', waiting: 1 }),
  ];

  it('lists only the selected repository by default and all of them on request', async () => {
    window.location.hash = '#runs';
    const { api } = twoRepositories();
    const first = render(<App api={api} openStream={openFake} />);
    snapshot(mixed());
    expect(await screen.findByText('app one')).toBeTruthy();
    expect(screen.queryByText('lib waits')).toBeNull();
    expect(screen.queryByTitle(APP + '/')).toBeNull();
    // counters follow the mode: two of /work/app work, /work/lib is not counted
    const runsLink = screen.getByRole('link', { name: /Runs/ });
    expect(within(runsLink).getAllByLabelText('running: 2').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('radio', { name: 'All repositories' }));
    expect(await screen.findByText('lib waits')).toBeTruthy();
    expect(screen.getAllByTitle(APP).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(LIB).length).toBeGreaterThan(0);
    expect(
      within(runsLink).getAllByLabelText('running: 4, waiting for an answer: 1').length,
    ).toBeGreaterThan(0);
    first.unmount();

    render(<App api={api} openStream={openFake} />);
    snapshot(mixed());
    expect(await screen.findByText('lib waits')).toBeTruthy();
  });
});

describe('repository registry in the panel', () => {
  const NEW = '/work/new';

  async function ready(api: Api) {
    render(<App api={api} openStream={openFake} />);
    snapshot();
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: app'));
  }

  it('adds an item for a repository that arrives in a repositories event', async () => {
    const { api } = twoRepositories();
    await ready(api);
    act(() =>
      FakeEventSource.last?.send({
        event: 'repositories',
        seq: 5,
        repositories: [entry(APP), entry(LIB), entry(NEW)],
      }),
    );
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(await screen.findByRole('menuitemradio', { name: /new/ })).toBeTruthy();
  });

  it('adds a repository from the dialog and selects it', async () => {
    const addRepository = vi.fn(async () => [entry(APP), entry(LIB), entry(NEW)]);
    const { api } = twoRepositories({ addRepository });
    await ready(api);
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add repository…' }));
    fireEvent.change(await screen.findByLabelText('Path'), { target: { value: `${NEW}/sub` } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addRepository).toHaveBeenCalledWith(`${NEW}/sub`));
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: new'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog open with the error of the daemon', async () => {
    const addRepository = vi.fn(async () => {
      throw new Error('not a git repository');
    });
    const { api } = twoRepositories({ addRepository });
    await ready(api);
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add repository…' }));
    fireEvent.change(await screen.findByLabelText('Path'), { target: { value: '/tmp/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('alert')).textContent).toBe('not a git repository');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(trigger().getAttribute('aria-label')).toBe('Repository: app');
  });

  it('offers "Remove from list" for every repository except the home one', async () => {
    const { api } = twoRepositories();
    await ready(api);
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    const items = await screen.findAllByRole('menuitemradio');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).queryByRole('button', { name: 'Remove from list' })).toBeNull();
    expect(within(items[1]!).getByRole('button', { name: 'Remove from list' })).toBeTruthy();
  });

  it('removes a repository after confirmation, and a refusal leaves the item with a notice', async () => {
    const removeRepository = vi
      .fn<(path: string) => Promise<RepositoryView[]>>()
      .mockRejectedValueOnce(new Error('repository has unfinished runs: 1'))
      .mockResolvedValueOnce([entry(APP)]);
    const { api } = twoRepositories({ removeRepository });
    await ready(api);
    const remove = async () => {
      fireEvent.keyDown(trigger(), { key: 'Enter' });
      fireEvent.click(await screen.findByRole('button', { name: 'Remove from list' }));
      fireEvent.click(
        await within(await screen.findByRole('alertdialog')).findByRole('button', {
          name: 'Remove from list',
        }),
      );
    };
    await remove();
    expect(await screen.findByText('repository has unfinished runs: 1')).toBeTruthy();
    expect(removeRepository).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getAllByRole('menuitemradio', { hidden: true })
        .some((item) => /lib/.test(item.textContent ?? '')),
    ).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await remove();
    await waitFor(() => expect(removeRepository).toHaveBeenCalledTimes(2));
    expect(removeRepository).toHaveBeenLastCalledWith(LIB);
  });

  it('returns to the home repository when the selected one is removed', async () => {
    const removeRepository = vi.fn(async () => [entry(APP)]);
    const { api } = twoRepositories({ removeRepository });
    await ready(api);
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /lib/ }));
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: lib'));
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from list' }));
    fireEvent.click(
      await within(await screen.findByRole('alertdialog')).findByRole('button', {
        name: 'Remove from list',
      }),
    );
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: app'));
    expect(window.localStorage.getItem('aip.web.repository')).toBe('null');
  });
});
