// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import type { Api } from '../src/shared/api/api.ts';
import type { QueueView, RunView } from '../src/shared/api/types.ts';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import {
  FakeEventSource,
  fakeApi,
  openFake,
  pipelineOf,
  pipelinesView,
  queueItem,
  queueOf,
  repositoryView,
  runView,
} from './fixtures.ts';

const APP = '/work/app';
const LIB = '/work/lib';

beforeEach(() => {
  window.location.hash = '#queue/new';
  window.localStorage.clear();
});
afterEach(() => cleanup());

const strip = () => within(screen.getAllByRole('banner')[0]!);
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

const ui = { id: 'tu', repository: LIB, name: 'ui', color: 'red' as const, task: null };

function mount(
  options: { runs?: RunView[]; noSnapshot?: boolean; lateLib?: boolean; tags?: boolean } = {},
) {
  const appQueue = queueOf({ repository: APP, items: [queueItem('qa', 'app task', 1)] });
  let asked = 0;
  const api = fakeApi({
    queue: vi.fn(() =>
      options.noSnapshot || (options.lateLib && asked++ > 0)
        ? new Promise<QueueView>(() => undefined)
        : Promise.resolve(appQueue),
    ),
    runs: vi.fn(async () => []),
    pipelines: vi.fn(async (repository?: string) =>
      repository === LIB
        ? pipelinesView({ repository: LIB, pipelines: [pipelineOf({ id: 'docs' })] })
        : pipelinesView({ repository: APP }),
    ),
    queueAdd: vi.fn(async () => ({
      ...queueOf({ repository: APP, items: [queueItem('q7', 'made', 7)] }),
      item: 'q7',
    })),
  });
  const queues: QueueView[] = options.lateLib
    ? [appQueue]
    : [
        appQueue,
        queueOf({ repository: LIB, autoDeliver: false, items: [queueItem('ql0', 'lib old', 3)] }),
      ];
  render(<App api={api as Api} openStream={openFake} />);
  if (!options.noSnapshot)
    act(() => {
      FakeEventSource.last?.send({
        event: 'snapshot',
        seq: 1,
        runs: options.runs ?? [runView({ id: 'a1', repository: APP })],
        queues: queues,
        repositories: [repositoryView(APP), repositoryView(LIB)],
        ...(options.tags ? { tags: [ui] } : {}),
      });
    });
  return { api };
}

const textField = () => screen.findByLabelText<HTMLTextAreaElement>('Task text');

async function ready() {
  const field = await textField();
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
  );
  return field;
}

describe('page of a new task', () => {
  it('shows the section, the link, the title, the form and focuses the text', async () => {
    mount();
    const field = await ready();
    expect(screen.getByRole('heading', { name: 'New task' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '← Queue' }).getAttribute('href')).toBe('#queue');
    expect(screen.getByRole('combobox', { name: 'Repository' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(field.rows).toBe(9);
    expect(field.className).toContain('flex-1');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it('shows a skeleton instead of the form until the queue is loaded', async () => {
    mount({ lateLib: true });
    await ready();
    const trigger = document.querySelector<HTMLElement>('[data-repository-trigger]')!;
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /lib/ }));
    await waitFor(() => expect(screen.queryByLabelText('Task text')).toBeNull());
    expect(await screen.findByRole('heading', { name: 'New task' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading the queue' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '← Queue' })).toBeTruthy();
    expect(screen.queryByLabelText('Task text')).toBeNull();
  });

  it('Add clears the draft, leads to the queue and announces the task', async () => {
    const { api } = mount();
    const field = await ready();
    fireEvent.change(field, { target: { value: 'Do it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(window.location.hash).toBe('#queue'));
    await waitFor(() => expect(screen.getAllByText('Task #7 created').length).toBeGreaterThan(0));
    expect(api.queueAdd).toHaveBeenCalledWith(expect.objectContaining({ task: 'Do it' }));
    expect(await screen.findByRole('list', { name: 'tasks in the queue' })).toBeTruthy();
    expect(screen.getAllByText(/#7/).length).toBeGreaterThan(0);
    fireEvent.click(strip().getByRole('button', { name: 'New task' }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    expect((within(dialog).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('');
  });

  it('Add and continue stays on the page', async () => {
    const { api } = mount();
    const field = await ready();
    fireEvent.change(field, { target: { value: 'One' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add and continue' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(''));
    expect(window.location.hash).toBe('#queue/new');
  });

  it('keeps the page, the error and the text when the server rejects', async () => {
    const { api } = mount();
    (api.queueAdd as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'));
    const field = await ready();
    fireEvent.change(field, { target: { value: 'Keep' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('nope');
    expect(window.location.hash).toBe('#queue/new');
    expect((field as HTMLTextAreaElement).value).toBe('Keep');
  });

  it('Cancel and the link lead to the queue without a request and keep the draft', async () => {
    const { api } = mount();
    const field = await ready();
    fireEvent.change(field, { target: { value: 'Draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(window.location.hash).toBe('#queue'));
    expect(api.queueAdd).not.toHaveBeenCalled();
    window.location.hash = '#queue/new';
    expect(((await textField()) as HTMLTextAreaElement).value).toBe('Draft');
    fireEvent.click(screen.getByRole('link', { name: '← Queue' }));
    await waitFor(() => expect(window.location.hash).toBe('#queue'));
    expect(api.queueAdd).not.toHaveBeenCalled();
  });

  it('shares the draft with the dialog in both directions', async () => {
    mount();
    fireEvent.change(await ready(), { target: { value: 'from page' } });
    window.location.hash = '#queue';
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(strip().getByRole('button', { name: 'New task' }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    const inDialog = within(dialog).getByLabelText<HTMLTextAreaElement>('Task text');
    expect(inDialog.value).toBe('from page');
    expect(inDialog.className).not.toContain('flex-1');
    expect(inDialog.rows).toBe(9);
    fireEvent.change(inDialog, { target: { value: 'from dialog' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Expand to page' }));
    expect(((await textField()) as HTMLTextAreaElement).value).toBe('from dialog');
  });

  it('keeps the text over queue and run events', async () => {
    mount();
    const field = await ready();
    fireEvent.change(field, { target: { value: 'stay' } });
    act(() => {
      FakeEventSource.last?.send({
        event: 'queue',
        seq: 2,
        queue: queueOf({ repository: APP, items: [] }),
      });
      FakeEventSource.last?.send({
        event: 'run',
        seq: 3,
        run: runView({ id: 'a1', repository: APP, title: 'changed' }),
      });
    });
    expect((field as HTMLTextAreaElement).value).toBe('stay');
  });

  it('targets the chosen repository without moving the panel', async () => {
    const { api } = mount();
    await ready();
    fireEvent.click(screen.getByRole('combobox', { name: 'Repository' }));
    fireEvent.click(await screen.findByRole('option', { name: /lib/ }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('docs'),
    );
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'doc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add and continue' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect(window.location.hash).toBe('#queue/new');
    expect(
      (api as unknown as { calls: unknown[][] }).calls.filter(([n]) => n === 'queueAdd'),
    ).toEqual([['queueAdd', LIB]]);
    expect(document.querySelector('[data-repository-trigger]')?.getAttribute('aria-label')).toBe(
      'Repository: app',
    );
  });
});

describe('repository of the page', () => {
  it('follows the header, keeps the text and drops "Waits for"', async () => {
    mount();
    const field = await ready();
    fireEvent.change(field, { target: { value: 'keep me' } });
    const waits = screen.getByRole('combobox', { name: 'Waits for' });
    fireEvent.click(waits);
    fireEvent.click(await screen.findByRole('option', { name: /app task/ }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => {
      expect(waits.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryAllByText(/app task/).length).toBeGreaterThan(0);
    });
    const trigger = document.querySelector<HTMLElement>('[data-repository-trigger]')!;
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /lib/ }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Repository' }).textContent).toContain('lib'),
    );
    expect(window.location.hash).toBe('#queue/new');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Task text').value).toBe('keep me');
    expect(screen.queryAllByText(/app task/)).toHaveLength(0);
  });
});

describe('ways to the page', () => {
  it('expands the dialog keeping repository, tag and text', async () => {
    mount({ tags: true });
    window.location.hash = '#queue';
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(strip().getByRole('button', { name: 'New task' }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Repository' }));
    fireEvent.click(await screen.findByRole('option', { name: /lib/ }));
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('docs'),
    );
    const tags = await within(dialog).findByRole('combobox', { name: 'Tags' });
    fireEvent.click(tags);
    fireEvent.click(await screen.findByRole('option', { name: 'ui' }));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => expect(tags.getAttribute('aria-expanded')).toBe('false'));
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'carry' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Expand to page' }));
    await waitFor(() => expect(window.location.hash).toBe('#queue/new'));
    expect(screen.queryByRole('dialog')).toBeNull();
    const field = await textField();
    expect(field.value).toBe('carry');
    expect(screen.getByRole('combobox', { name: 'Repository' }).textContent).toContain('lib');
    expect(screen.getAllByText('ui').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-repository-trigger]')?.getAttribute('aria-label')).toBe(
      'Repository: app',
    );
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it('keeps the parent of an expanded subtask', async () => {
    mount({
      runs: [
        runView({
          id: 'a1',
          repository: APP,
          number: 115,
          title: 'Вход',
          finished: true,
          state: 'finished',
          finishedAt: 5_000,
        }),
      ],
    });
    window.location.hash = '#runs/a1';
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'More' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Create subtask…' }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Parent task' }).textContent).toBe(
        '#115 Вход',
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Expand to page' }));
    await waitFor(() => expect(window.location.hash).toBe('#queue/new'));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Parent task' }).textContent).toBe('#115 Вход'),
    );
  });

  it('opens from the palette and focuses the text', async () => {
    mount();
    window.location.hash = '#queue';
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.keyDown(window, { key: 'k', metaKey: isMac, ctrlKey: !isMac });
    fireEvent.click(await screen.findByText('New task on a page'));
    await waitFor(() => expect(window.location.hash).toBe('#queue/new'));
    const field = await textField();
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it('the plus button focuses the text instead of opening the dialog', async () => {
    mount();
    const field = await ready();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(strip().getByRole('button', { name: 'New task' }));
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
