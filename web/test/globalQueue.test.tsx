// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { GlobalTakeFilter } from '../src/features/queue/global/GlobalTakeFilter.tsx';
import { lineOf } from '../src/features/queue/global/asQueue.ts';
import { TagsProvider } from '../src/shared/lib/catalog/tags.tsx';
import { applyEvent } from '../src/shared/api/runs/streamEvents.ts';
import type { Api } from '../src/shared/api/api.ts';
import type { GlobalQueueItemView, GlobalQueueView, QueueView } from '../src/shared/api/types.ts';

import {
  FakeSocket,
  fakeApi,
  dependency,
  openFake,
  queueItem,
  queueRun,
  queueOf,
  repositoryView,
  runView,
  tagView,
  pipelineOf,
  pipelinesView,
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
    filter: { pipelines: [], projects: [], tags: [] },
    filterTags: undefined,
    max: 4,
    items: [globalItem('qa', 'task of app', 1, APP), globalItem('ql', 'task of lib', 2, LIB)],
    ...overrides,
  } as unknown as GlobalQueueView;
}

/** The daemon answers an action of the global mode with the global queue. */
const asAnswer = (view: GlobalQueueView) => view as unknown as QueueView;

function mount(
  globalQueue: GlobalQueueView | null,
  api: Partial<Api> = {},
  tags: ReturnType<typeof tagView>[] = [],
  colors: { app: string | null; lib: string | null } = { app: null, lib: null },
) {
  const fake = fakeApi({ queue: vi.fn(async () => queueOf({ repository: APP })), ...api });
  render(<App api={fake as Api} openStream={openFake} />);
  act(() => {
    FakeSocket.last?.send({
      event: 'snapshot',
      seq: 1,
      runs: [runView({ id: 'a1', repository: APP })],
      queues: globalQueue ? [] : [queueOf({ repository: APP })],
      ...(globalQueue ? { globalQueue } : {}),
      repositories: [
        repositoryView(APP, { color: colors.app }),
        repositoryView(LIB, { color: colors.lib }),
      ],
      tags,
    });
  });
  return fake;
}

describe('page of the global queue', () => {
  it('shows the badge, the limit and the tasks of all projects with their projects', async () => {
    mount(globalOf());
    expect(await screen.findByText('Global queue')).toBeTruthy();
    expect(screen.getByText(/At most 4 agents/)).toBeTruthy();
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

  it('highlights cross-project dependency chains and their run, except while dragging', async () => {
    mount(
      globalOf({
        status: 'running',
        runs: [{ ...queueRun('r1', { title: 'predecessor run' }), repository: LIB }] as never,
        items: [
          {
            ...globalItem('q1', 'first', 1, APP),
            after: [dependency('run', 'r1', 'predecessor run')],
          },
          { ...globalItem('q2', 'second', 2, LIB), after: [dependency('item', 'q1', 'first')] },
          { ...globalItem('q3', 'third', 3, APP), after: [dependency('item', 'q2', 'second')] },
          globalItem('q4', 'independent', 4, LIB),
        ],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const row = (id: string) => document.querySelector(`li[data-id="${id}"]`) as HTMLElement;
    const card = screen.getByRole('group', { name: 'predecessor run' });
    expect(['q1', 'q2', 'q3', 'q4'].map((id) => row(id).getAttribute('data-depth'))).toEqual([
      '0',
      '1',
      '2',
      '0',
    ]);
    fireEvent.mouseEnter(row('q2'));
    for (const id of ['q1', 'q2', 'q3'])
      expect(row(id).hasAttribute('data-highlighted')).toBe(true);
    expect(row('q4').hasAttribute('data-highlighted')).toBe(false);
    fireEvent.mouseLeave(row('q2'));
    fireEvent.focus(row('q1'));
    expect(card.hasAttribute('data-highlighted')).toBe(true);
    fireEvent.dragStart(row('q1'), { dataTransfer: { setData: vi.fn() } });
    fireEvent.mouseEnter(row('q2'));
    fireEvent.focus(row('q1'));
    expect(card.hasAttribute('data-highlighted')).toBe(false);
    for (const id of ['q1', 'q2', 'q3'])
      expect(row(id).hasAttribute('data-highlighted')).toBe(false);
    fireEvent.dragEnd(row('q1'));
    fireEvent.mouseEnter(row('q4'));
    expect(row('q4').hasAttribute('data-highlighted')).toBe(false);
  });

  it('moves a task by its place among all projects through the project of the task', async () => {
    const edit = vi.fn(async () => queueOf());
    const api = mount(globalOf(), { queueEdit: edit });
    const first = await screen.findByLabelText(/^1\. /);
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(edit).toHaveBeenCalledWith('qa', { position: 2 }));
    expect(api.calls).toContainEqual(['queueEdit', APP]);
  });

  it('locks the filter fields of a running queue and says why', async () => {
    const settings = vi.fn(async () => queueOf());
    mount(globalOf({ status: 'running' }), { queueSettings: settings });
    const block = within(await screen.findByLabelText('take filter'));
    fireEvent.click(block.getByRole('button', { name: /Take filter/ }));
    expect(await block.findByText(/Stop the queue to change the filter/)).toBeTruthy();
    for (const name of ['Pipeline', 'Projects', 'Tags']) {
      expect((block.getByRole('combobox', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(settings).not.toHaveBeenCalled();
  });

  it('sets the filter of projects and of pipelines of a stopped queue', async () => {
    const settings = vi.fn(async () => asAnswer(globalOf()));
    mount(globalOf(), { queueSettings: settings });
    const block = within(await screen.findByLabelText('take filter'));
    fireEvent.click(block.getByRole('button', { name: /Take filter/ }));
    fireEvent.click(await block.findByRole('combobox', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('option', { name: /lib/ }));
    await waitFor(() => expect(settings).toHaveBeenCalledWith({ filter: { projects: [LIB] } }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(await block.findByRole('combobox', { name: 'Pipeline' }));
    fireEvent.click(await screen.findByRole('option', { name: 'feature' }));
    await waitFor(() =>
      expect(settings).toHaveBeenCalledWith({ filter: { pipelines: ['feature'] } }),
    );
  });

  it('offers a pipeline of several projects once', async () => {
    mount(globalOf());
    const block = within(await screen.findByLabelText('take filter'));
    fireEvent.click(block.getByRole('button', { name: /Take filter/ }));
    fireEvent.click(await block.findByRole('combobox', { name: 'Pipeline' }));
    await screen.findByRole('option', { name: 'feature' });
    expect(screen.getAllByRole('option', { name: 'feature' })).toHaveLength(1);
  });

  it('offers distinct tag names from all projects and sends the chosen name', async () => {
    const settings = vi.fn(async () =>
      asAnswer(globalOf({ filter: { pipelines: [], projects: [], tags: ['shared'] } as never })),
    );
    mount(globalOf(), { queueSettings: settings }, [
      { ...tagView('shared'), id: 'a', repository: APP },
      { ...tagView('Shared'), id: 'b', repository: LIB },
      { ...tagView('lib-only'), id: 'c', repository: LIB },
    ]);
    const block = within(await screen.findByLabelText('take filter'));
    fireEvent.click(block.getByRole('button', { name: /Take filter/ }));
    fireEvent.click(await block.findByRole('combobox', { name: 'Tags' }));
    expect(await screen.findAllByRole('option', { name: /^shared/ })).toHaveLength(1);
    expect(screen.getByRole('option', { name: /^lib-only/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /^shared/ }));
    await waitFor(() => expect(settings).toHaveBeenCalledWith({ filter: { tags: ['shared'] } }));
    expect(await block.findByText('shared')).toBeTruthy();
  });

  it('counts and resets selected tag names, including names no longer in the catalog', async () => {
    const settings = vi.fn(async () => asAnswer(globalOf()));
    mount(globalOf({ filter: { pipelines: [], projects: [], tags: ['missing'] } as never }), {
      queueSettings: settings,
    });
    const block = within(await screen.findByLabelText('take filter'));
    expect(block.getByText('1')).toBeTruthy();
    expect(block.getByText(/missing/)).toBeTruthy();
    fireEvent.click(block.getByRole('button', { name: 'Reset' }));
    await waitFor(() =>
      expect(settings).toHaveBeenCalledWith({ filter: { pipelines: [], projects: [], tags: [] } }),
    );
  });

  it('groups same-name tags with each project color and scopes choices without dropping selections', async () => {
    const settings = vi.fn(async () =>
      asAnswer(globalOf({ filter: { pipelines: [], projects: [LIB], tags: ['shared'] } as never })),
    );
    mount(
      globalOf({ filter: { pipelines: [], projects: [], tags: ['shared'] } as never }),
      { queueSettings: settings },
      [
        { ...tagView('shared'), id: 'a', repository: APP, color: 'red' },
        { ...tagView('Shared'), id: 'b', repository: LIB, color: 'blue' },
        { ...tagView('app-only'), id: 'c', repository: APP, color: 'red' },
        { ...tagView('lib-only'), id: 'd', repository: LIB, color: 'blue' },
      ],
      { app: 'green', lib: 'violet' },
    );
    const block = within(await screen.findByLabelText('take filter'));
    expect(block.getByTitle('app').className).toContain('bg-[#22c55e]');
    expect(block.getByTitle('lib').className).toContain('bg-[#8b5cf6]');
    expect(block.getByTitle('app · lib').textContent).toBe('shared');
    fireEvent.click(await block.findByRole('combobox', { name: 'Tags' }));
    const shared = await screen.findByRole('option', { name: /^shared/ });
    expect(shared.querySelector('[title="app"] [data-project-color]')?.className).toContain(
      'bg-[#22c55e]',
    );
    expect(shared.querySelector('[title="lib"] [data-project-color]')?.className).toContain(
      'bg-[#8b5cf6]',
    );
    expect(block.getByTitle('app · lib')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(block.getByRole('combobox', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('option', { name: /lib/ }));
    await waitFor(() => expect(settings).toHaveBeenCalledWith({ filter: { projects: [LIB] } }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(await block.findByRole('combobox', { name: 'Tags' }));
    expect(await screen.findByRole('option', { name: /^lib-only/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /^app-only/ })).toBeNull();
    expect(
      screen.getByRole('option', { name: /^shared/ }).querySelector('[title="app"]'),
    ).toBeNull();
  });

  it('draws a gray dot for a project without a color in the selection and in the list', async () => {
    mount(
      globalOf({ filter: { pipelines: [], projects: [], tags: ['shared'] } as never }),
      {},
      [
        { ...tagView('shared'), id: 'a', repository: APP, color: 'red' },
        { ...tagView('shared'), id: 'b', repository: LIB, color: 'blue' },
      ],
      { app: null, lib: 'violet' },
    );
    const block = within(await screen.findByLabelText('take filter'));
    expect(block.getByTitle('app').className).toContain('bg-[#6b7280]');
    expect(block.getByTitle('lib').className).toContain('bg-[#8b5cf6]');
    fireEvent.click(await block.findByRole('combobox', { name: 'Tags' }));
    const shared = await screen.findByRole('option', { name: /^shared/ });
    expect(shared.querySelector('[title="app"] [data-project-color]')?.className).toContain(
      'bg-[#6b7280]',
    );
  });

  it('finds a tag by the name of its project', async () => {
    mount(globalOf(), {}, [
      { ...tagView('app-only'), id: 'c', repository: APP },
      { ...tagView('lib-only'), id: 'd', repository: LIB },
    ]);
    const block = within(await screen.findByLabelText('take filter'));
    fireEvent.click(block.getByRole('button', { name: /Take filter/ }));
    fireEvent.click(await block.findByRole('combobox', { name: 'Tags' }));
    fireEvent.change(await screen.findByPlaceholderText(/search/i), { target: { value: 'lib' } });
    await waitFor(() => expect(screen.queryByRole('option', { name: /^app-only/ })).toBeNull());
    expect(screen.getByRole('option', { name: /^lib-only/ })).toBeTruthy();
  });

  it('keeps out-of-scope criteria removable and rolls back a failed project change', async () => {
    const settings = vi.fn(async () => {
      throw new Error('save failed');
    });
    mount(
      globalOf({ filter: { pipelines: ['gone'], projects: [LIB], tags: ['old'] } as never }),
      { queueSettings: settings },
      [{ ...tagView('old'), repository: APP }],
    );
    const block = within(await screen.findByLabelText('take filter'));
    expect(block.getByText(/old \(not in the configuration\)/)).toBeTruthy();
    expect(block.getByText(/gone \(not in the configuration\)/)).toBeTruthy();
    expect(block.getByTitle('not in the configuration').textContent).toContain('old');
    fireEvent.click(block.getByRole('combobox', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('option', { name: /app/ }));
    await waitFor(() =>
      expect(settings).toHaveBeenCalledWith({ filter: { projects: [LIB, APP] } }),
    );
    expect((await screen.findAllByText('save failed')).length).toBeGreaterThan(0);
    expect(block.getByText(/old \(not in the configuration\)/)).toBeTruthy();
    fireEvent.click(block.getByRole('button', { name: /Remove old/ }));
    await waitFor(() => expect(settings).toHaveBeenCalledWith({ filter: { tags: [] } }));
    fireEvent.click(block.getByRole('button', { name: /Remove gone/ }));
    await waitFor(() => expect(settings).toHaveBeenCalledWith({ filter: { pipelines: [] } }));
    fireEvent.click(block.getByRole('button', { name: 'Reset' }));
    await waitFor(() =>
      expect(settings).toHaveBeenCalledWith({ filter: { projects: [], tags: [], pipelines: [] } }),
    );
  });

  it.each([
    { projects: [] as string[], app: true, lib: true },
    { projects: [APP, LIB], app: true, lib: true },
    { projects: [LIB], app: false, lib: true },
    { projects: ['/work/missing'], app: false, lib: false },
  ])(
    'limits tags and pipelines to the chosen project scope: $projects',
    async ({ projects, app, lib }) => {
      const tags = [
        { ...tagView('shared', 'red', 'a'), repository: APP },
        { ...tagView('Shared', 'blue', 'b'), repository: LIB },
        { ...tagView('app-only'), repository: APP },
        { ...tagView('lib-only'), repository: LIB },
        { ...tagView('excluded'), repository: '/work/disabled' },
      ];
      const pipelines = new Map([
        [APP, pipelinesView({ pipelines: [pipelineOf(), pipelineOf({ id: 'explore' })] })],
        [LIB, pipelinesView({ pipelines: [pipelineOf(), pipelineOf({ id: 'build' })] })],
        ['/work/disabled', pipelinesView({ pipelines: [pipelineOf({ id: 'excluded' })] })],
      ]);
      render(
        <TagsProvider tags={tags}>
          <GlobalTakeFilter
            api={fakeApi() as Api}
            queue={globalOf({ filter: { projects, tags: [], pipelines: [] } as never })}
            projects={[
              repositoryView(APP, { color: 'green' }),
              repositoryView(LIB, { color: 'violet' }),
            ]}
            pipelines={pipelines}
            onQueue={() => {}}
            onError={() => {}}
          />
        </TagsProvider>,
      );
      const block = within(screen.getByLabelText('take filter'));
      if (!projects.length) fireEvent.click(block.getByRole('button', { name: /Take filter/ }));
      fireEvent.click(block.getByRole('combobox', { name: 'Tags' }));
      expect(Boolean(screen.queryByRole('option', { name: /^app-only/ }))).toBe(app);
      expect(Boolean(screen.queryByRole('option', { name: /^lib-only/ }))).toBe(lib);
      expect(screen.queryByRole('option', { name: /^excluded/ })).toBeNull();
      expect(screen.queryAllByRole('option', { name: /^shared/i })).toHaveLength(
        app || lib ? 1 : 0,
      );
      if (app && lib) {
        const shared = screen.getByRole('option', { name: /^shared/i });
        expect(screen.queryByRole('group', { name: 'app · lib' })).toBeNull();
        expect(within(shared).queryByText('app · lib')).toBeNull();
        expect(within(shared).getAllByText('app')).toHaveLength(1);
        expect(within(shared).getAllByText('lib')).toHaveLength(1);
        expect(
          within(shared).getByText('app').querySelector('[data-project-color]')?.className,
        ).toContain('bg-[#22c55e]');
        expect(
          within(shared).getByText('lib').querySelector('[data-project-color]')?.className,
        ).toContain('bg-[#8b5cf6]');
        expect(shared.querySelector('a')).toBeNull();
      }
      fireEvent.keyDown(document.body, { key: 'Escape' });
      fireEvent.click(block.getByRole('combobox', { name: 'Pipeline' }));
      expect(Boolean(screen.queryByRole('option', { name: 'explore' }))).toBe(app);
      expect(Boolean(screen.queryByRole('option', { name: 'build' }))).toBe(lib);
      expect(screen.queryByRole('option', { name: 'excluded' })).toBeNull();
      expect(screen.queryAllByRole('option', { name: 'feature' })).toHaveLength(app || lib ? 1 : 0);
    },
  );

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
      FakeSocket.last?.send({
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

describe('controls of the global queue', () => {
  const row = async (id: string) =>
    within(
      (await screen.findAllByRole('listitem')).find((li) => li.getAttribute('data-id') === id)!,
    );

  it('loads the pipelines of every project through the project', async () => {
    const api = mount(globalOf());
    await screen.findByText('Global queue');
    await waitFor(() => {
      expect(api.calls).toContainEqual(['pipelines', APP]);
      expect(api.calls).toContainEqual(['pipelines', LIB]);
    });
  });

  it('gives a task of another project the buttons of a project queue', async () => {
    const edit = vi.fn(async () => asAnswer(globalOf()));
    const api = mount(globalOf(), { queueEdit: edit });
    const lib = await row('ql');
    for (const name of ['Edit', 'Postpone', 'Run now', 'Remove']) {
      expect(lib.getByRole('button', { name })).toBeTruthy();
    }
    fireEvent.click(lib.getByRole('button', { name: 'Postpone' }));
    await waitFor(() => expect(edit).toHaveBeenCalledWith('ql', { postponed: true }));
    expect(api.calls).toContainEqual(['queueEdit', LIB]);
  });

  it('opens the edit form of a task with the tags of its project', async () => {
    const tag = { ...tagView('Lib tag'), repository: LIB };
    const tags = vi.fn(async () => [tag]);
    const api = mount(globalOf(), { tags });
    fireEvent.click((await row('ql')).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
    await waitFor(() => expect(api.calls).toContainEqual(['tags', LIB]));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Tags' }));
    expect(await screen.findByRole('option', { name: 'Lib tag' })).toBeTruthy();
  });

  it('offers other tasks to wait for, but not the edited task itself', async () => {
    mount(globalOf());
    fireEvent.click((await row('ql')).getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add link' }));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Linked task' }));
    expect(await screen.findByRole('option', { name: /task of app/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /task of lib/ })).toBeNull();
  });

  it('saves the edit form through the project of the task', async () => {
    const edit = vi.fn(async () => asAnswer(globalOf()));
    const api = mount(globalOf(), { queueEdit: edit });
    fireEvent.click((await row('ql')).getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('Task text'), {
      target: { value: 'changed text' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(edit).toHaveBeenCalledWith('ql', expect.anything()));
    expect(api.calls).toContainEqual(['queueEdit', LIB]);
  });

  it('runs and removes a task through its project', async () => {
    const remove = vi.fn(async () => asAnswer(globalOf()));
    const runNow = vi.fn(async () => ({
      runId: 'run9',
      number: 9,
      branch: 'refs/aip/run9/run',
      groups: [],
      split: true,
      warnings: [],
    }));
    const api = mount(globalOf(), { queueRemove: remove, queueRunNow: runNow });
    const lib = await row('ql');
    fireEvent.click(lib.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(runNow).toHaveBeenCalledWith('ql'));
    expect(api.calls).toContainEqual(['queueRunNow', LIB]);
    fireEvent.click((await row('ql')).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('ql'));
    expect(api.calls).toContainEqual(['queueRemove', LIB]);
  });

  it('puts an answer of the global mode into the global queue, not into a project queue', async () => {
    const answer = globalOf({ items: [globalItem('qz', 'answered', 1, LIB)] });
    mount(globalOf(), { queueRemove: vi.fn(async () => answer as never) });
    fireEvent.click((await row('ql')).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('li[data-id]')].map((li) => li.getAttribute('data-id')),
      ).toEqual(['qz']),
    );
  });

  it('pauses a run and shows the free places', async () => {
    const pause = vi.fn(async () => asAnswer(globalOf()));
    mount(
      globalOf({
        status: 'running',
        parallel: 3,
        runs: [{ ...queueRun('r1', { title: 'lib run' }), repository: LIB }] as never,
      }),
      { pauseRun: pause as never },
    );
    const section = within(await screen.findByRole('region', { name: /running from the queue/i }));
    expect(section.getAllByText('Free place')).toHaveLength(2);
    fireEvent.click(section.getByRole('button', { name: 'Pause run' }));
    await waitFor(() => expect(pause).toHaveBeenCalledWith('r1', LIB));
  });

  it('returns and dismisses a skipped run with the project of the run', async () => {
    const skippedLib = globalOf({
      skipped: [
        { ...queueRun('s1', { title: 'skipped lib', state: 'failed' }), repository: LIB },
      ] as never,
    });
    const back = vi.fn(async () => asAnswer(skippedLib));
    const dismiss = vi.fn(async () => asAnswer(globalOf()));
    mount(skippedLib, { queueReturn: back as never, queueDismiss: dismiss });
    const skipped = within(await screen.findByRole('region', { name: 'skipped with a problem' }));
    expect(skipped.getByText('skipped lib')).toBeTruthy();
    fireEvent.click(skipped.getByRole('button', { name: 'Return to the queue' }));
    await waitFor(() => expect(back).toHaveBeenCalledWith('s1', LIB));
    fireEvent.click(skipped.getByRole('button', { name: 'Remove from list' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from list' }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith('s1', LIB));
  });
});

describe('line of a project in the global queue', () => {
  it('holds only the tasks and runs of the project', () => {
    const view = globalOf({
      runs: [
        { ...queueRun('r1'), repository: LIB },
        { ...queueRun('r2'), repository: APP },
      ] as never,
    });
    const line = lineOf(view, LIB);
    expect(line.repository).toBe(LIB);
    expect(line.items.map((item) => item.id)).toEqual(['ql']);
    expect(line.runs.map((run) => run.id)).toEqual(['r1']);
    expect(line.autoDeliver).toBeNull();
  });
});

describe('new task in the global mode', () => {
  /** The daemon answers `queue` with the global queue, which has no repository. */
  const globalApi = (extra: Partial<Api> = {}) => ({
    queue: vi.fn(async () => asAnswer(globalOf())),
    ...extra,
  });
  const openDialog = async () => {
    const button = within(screen.getAllByRole('banner')[0]!).getByRole<HTMLButtonElement>(
      'button',
      { name: 'New task' },
    );
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    return screen.findByRole('dialog', { name: 'New task' });
  };

  it('opens the dialog although the answer of the queue has no repository', async () => {
    mount(globalOf(), globalApi());
    const dialog = await openDialog();
    const field = within(dialog).getByRole('combobox', { name: 'Repository' });
    expect(field.textContent).toMatch(/app|lib/);
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe(
        'feature',
      ),
    );
  });

  it('adds a task of the chosen project and shows it in the global queue', async () => {
    const added = globalOf({
      items: [
        globalItem('qa', 'task of app', 1, APP),
        globalItem('ql', 'task of lib', 2, LIB),
        globalItem('qn', 'new one', 3, LIB),
      ],
      item: 'qn',
    } as never);
    const add = vi.fn(async () => asAnswer(added) as QueueView & { item: string });
    const fake = mount(globalOf(), globalApi({ queueAdd: add }));
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Repository' }));
    fireEvent.click(await screen.findByRole('option', { name: /lib/ }));
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe(
        'feature',
      ),
    );
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'new one' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(fake.calls).toContainEqual(['queueAdd', LIB]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    const rows = within(await screen.findByRole('list', { name: /tasks|queue/i })).getAllByRole(
      'listitem',
    );
    expect(rows.map((row) => row.getAttribute('data-id'))).toEqual(['qa', 'ql', 'qn']);
    expect(rows[2]!.querySelector(`[data-project="${LIB}"]`)).not.toBeNull();
  });

  it('offers the tasks of all projects under «Waits for»', async () => {
    mount(globalOf(), globalApi());
    const dialog = await openDialog();
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe(
        'feature',
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    fireEvent.click(await within(dialog).findByRole('combobox', { name: 'Linked task' }));
    expect(await screen.findByRole('option', { name: /task of app/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /task of lib/ })).toBeTruthy();
  });

  it('moves the form to its own page', async () => {
    mount(globalOf(), globalApi());
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Expand to page' }));
    await waitFor(() => expect(window.location.hash).toBe('#queue/new'));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
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
