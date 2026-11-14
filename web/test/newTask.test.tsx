// @vitest-environment jsdom
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { emptyDraft, fieldsOf, retarget } from '../src/features/queue/QueueForm.tsx';
import type { Api } from '../src/shared/api/api.ts';
import type { QueueView, RunView } from '../src/shared/api/types.ts';
import { en } from '../src/shared/i18n/locales/en.ts';
import { es } from '../src/shared/i18n/locales/es.ts';
import { ru } from '../src/shared/i18n/locales/ru.ts';
import { zh } from '../src/shared/i18n/locales/zh.ts';

import {
  act,
  choose,
  cleanup,
  fireEvent,
  previewMarkdown,
  render,
  screen,
  waitFor,
  within,
} from './render.tsx';
import {
  FakeEventSource,
  fakeApi,
  openFake,
  queueItem,
  queueOf,
  repositoryView,
  runView,
  pipelineOf,
  pipelinesView,
} from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '#runs';
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function strip() {
  return within(screen.getAllByRole('banner')[0]!);
}

describe('new task from the top strip', () => {
  it('submits a title-only task as both title and task text', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: '  Only title  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        title: 'Only title',
        task: 'Only title',
      }),
    );
  });

  it('submits a description-only task without generating a title', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(within(dialog).getByLabelText('Task text'), {
      target: { value: '  Do work\nAnd verify  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        task: 'Do work\nAnd verify',
      }),
    );
  });

  it('blocks an empty task without submitting it', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    const add = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' });
    expect(add.disabled).toBe(true);
    fireEvent.submit(dialog.querySelector('form')!);
    expect(api.queueAdd).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect((within(dialog).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('');
  });

  it('preserves the original title-only draft when the server rejects it', async () => {
    const api = fakeApi({
      queue: vi.fn(async () => queueOf()),
      queueAdd: vi.fn(async () => {
        throw new Error('rejected');
      }),
    });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    const name = within(dialog).getByLabelText('Name') as HTMLInputElement;
    const text = within(dialog).getByLabelText('Task text') as HTMLTextAreaElement;
    fireEvent.change(name, { target: { value: '  title only  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'title only',
          task: 'title only',
        }),
      ),
    );
    await waitFor(() => expect(within(dialog).getByText('rejected')).toBeTruthy());
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    expect(name.value).toBe('  title only  ');
    expect(text.value).toBe('');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalledTimes(2));
    expect(api.queueAdd).toHaveBeenLastCalledWith({
      pipeline: 'feature',
      title: 'title only',
      task: 'title only',
    });
    expect(name.value).toBe('  title only  ');
    expect(text.value).toBe('');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    fireEvent.click(strip().getByRole('button', { name: 'New task' }));
    const reopened = await screen.findByRole('dialog', { name: 'New task' });
    expect((within(reopened).getByLabelText('Name') as HTMLInputElement).value).toBe(
      '  title only  ',
    );
    expect((within(reopened).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('');
  });

  it('clears the draft after a successful create and opens an empty form again', async () => {
    const api = fakeApi({
      queue: vi.fn(async () => queueOf()),
      queueAdd: vi.fn(async () => ({
        ...queueOf({ items: [queueItem('q5', 'Only title', 5)] }),
        item: 'q5',
      })),
    });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Only title' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByText('Task #5 created').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    fireEvent.click(strip().getByRole('button', { name: 'New task' }));
    const reopened = await screen.findByRole('dialog', { name: 'New task' });
    expect((within(reopened).getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect((within(reopened).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('');
  });

  it.each([
    ['en', en],
    ['es', es],
    ['ru', ru],
    ['zh', zh],
  ] as const)('shows the hint of each mode in %s', async (lang, dict) => {
    window.localStorage.setItem('aip.web.language', JSON.stringify(lang));
    await act(async () => {
      await i18next.changeLanguage(lang);
    });
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = await within(screen.getAllByRole('banner')[0]!).findByRole<HTMLButtonElement>(
      'button',
      { name: dict.nav.newTask },
    );
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(dict.queue.form.alternativeHint)).toBeTruthy();
    expect(within(dialog).queryByText(dict.queue.form.groupAlternativeHint)).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: dict.queue.form.groups }));
    expect(await within(dialog).findByText(dict.queue.form.groupAlternativeHint)).toBeTruthy();
    expect(within(dialog).queryByText(dict.queue.form.alternativeHint)).toBeNull();
  });

  it('submits mixed title-only and description-only groups in order', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Groups' }));
    fireEvent.change(within(dialog).getByLabelText('Title of group 1'), {
      target: { value: 'Only title' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add group' }));
    fireEvent.change(within(dialog).getByLabelText('Text of group 2'), {
      target: { value: 'Only description\nMore detail' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        groups: [
          { title: 'Only title', task: 'Only title' },
          { title: 'Only description', task: 'Only description\nMore detail' },
        ],
      }),
    );
  });

  it('preserves description-only group source on server error and retries the same payload', async () => {
    const api = fakeApi({
      queue: vi.fn(async () => queueOf()),
      queueAdd: vi.fn(async () => {
        throw new Error('rejected');
      }),
    });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Groups' }));
    fireEvent.change(within(dialog).getByLabelText('Text of group 1'), {
      target: { value: '\n  ## Original\n- detail  ' },
    });
    const payload = {
      pipeline: 'feature',
      groups: [{ title: '## Original', task: '## Original\n- detail' }],
    };
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalledWith(payload));
    await within(dialog).findByText('rejected');
    expect((within(dialog).getByLabelText('Title of group 1') as HTMLInputElement).value).toBe('');
    expect((within(dialog).getByLabelText('Text of group 1') as HTMLTextAreaElement).value).toBe(
      '\n  ## Original\n- detail  ',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalledTimes(2));
    expect(api.queueAdd).toHaveBeenLastCalledWith(payload);
  });

  it('keeps a description-only group draft over queue and run events and a reopen', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await screen.findByLabelText('Task text');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Groups' }));
    fireEvent.change(within(dialog).getByLabelText('Text of group 1'), {
      target: { value: 'Only text\nmore' },
    });
    act(() => {
      FakeEventSource.last!.open();
      FakeEventSource.last!.send({ event: 'queue', seq: 1, queue: queueOf() });
      FakeEventSource.last!.send({ event: 'run', seq: 2, run: runView() });
    });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    fireEvent.click(strip().getByRole('button', { name: 'New task' }));
    const again = await screen.findByRole('dialog', { name: 'New task' });
    expect((await within(again).findByLabelText<HTMLInputElement>('Title of group 1')).value).toBe(
      '',
    );
    expect(within(again).getByLabelText<HTMLTextAreaElement>('Text of group 1').value).toBe(
      'Only text\nmore',
    );
    expect(api.queueAdd).not.toHaveBeenCalled();
  });

  it('blocks submission when any group is completely empty', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Groups' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add group' }));
    fireEvent.change(within(dialog).getByLabelText('Title of group 1'), {
      target: { value: 'valid title' },
    });
    const add = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' });
    expect(add.disabled).toBe(true);
    fireEvent.submit(dialog.querySelector('form')!);
    expect(api.queueAdd).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText('Title of group 1') as HTMLInputElement).value).toBe(
      'valid title',
    );
    expect((within(dialog).getByLabelText('Title of group 2') as HTMLInputElement).value).toBe('');
    expect((within(dialog).getByLabelText('Text of group 2') as HTMLTextAreaElement).value).toBe(
      '',
    );
  });

  it('opens the dialog over the section and announces the created task', async () => {
    const api = fakeApi({
      queue: vi.fn(async () => queueOf()),
      queueAdd: vi.fn(async () => ({
        ...queueOf({ items: [queueItem('q12', 'Сделать вход', 12)] }),
        item: 'q12',
      })),
    });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    const hash = window.location.hash;
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await waitFor(() => expect(document.activeElement?.id).toBe('new-task'));
    expect(window.location.hash).toBe(hash);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(within(dialog).getByLabelText('Task text'), {
      target: { value: 'Сделать вход' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByText('Task #12 created').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    expect(window.location.hash).toBe(hash);
  });

  it('keeps the button disabled until the queue is loaded', async () => {
    let answer: (() => void) | undefined;
    const api = fakeApi({
      queue: vi.fn(
        () =>
          new Promise<ReturnType<typeof queueOf>>((resolve) => {
            answer = () => resolve(queueOf());
          }),
      ),
    });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    expect(button.disabled).toBe(true);
    await waitFor(() => expect(answer).toBeDefined());
    answer?.();
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('shares the draft with the queue page', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'черновик' } });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    window.location.hash = '#queue';
    const controls = await screen.findByRole('region', { name: 'queue controls' });
    fireEvent.click(within(controls).getByRole('button', { name: 'New task' }));
    const again = await screen.findByRole('dialog', { name: 'New task' });
    expect((within(again).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe(
      'черновик',
    );
  });
  it('gives every field of the new task dialog the same height', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    const field = within(dialog);
    expect(field.getByPlaceholderText('Name (optional)').className).toContain('h-9.5');
    expect(field.getByRole('combobox', { name: 'Repository' }).className).toContain('h-9.5');
    expect(field.getByRole('combobox', { name: 'Pipeline' }).className).toContain('h-9.5');
    expect(field.getByRole('combobox', { name: 'Delivery mode' }).className).toContain('h-9.5');
    expect(field.getByRole('combobox', { name: 'Waits for' }).parentElement?.className).toContain(
      'min-h-9.5',
    );
    expect(field.getByRole('combobox', { name: 'Tags' }).parentElement?.className).toContain(
      'min-h-9.5',
    );
  });
});

describe('retarget', () => {
  const steps = (id: string) => (id === 'docs' ? ['write'] : ['plan', 'code']);
  const draft = {
    ...emptyDraft('feature'),
    title: 'name',
    task: 'text',
    tags: ['t1'],
    autoDeliver: false,
    after: ['q1'],
    afterTouched: true,
    parent: 'run1',
    parentTouched: true,
    skip: ['plan', 'review'],
    repository: '/work/app',
  };

  it('keeps a pipeline the new repository has and clears the links', () => {
    const moved = retarget(draft, ['docs', 'feature'], steps);
    expect(moved.pipeline).toBe('feature');
    expect(moved.after).toEqual([]);
    expect(moved.parent).toBeNull();
    expect(moved.afterTouched).toBe(false);
    expect(moved.parentTouched).toBe(false);
    expect(moved.skip).toEqual(['plan']);
    // the tags belong to the catalog of the old repository
    expect([moved.title, moved.task, moved.tags, moved.autoDeliver]).toEqual([
      'name',
      'text',
      [],
      false,
    ]);
  });

  it('replaces a missing pipeline with the first one and drops its skipped steps', () => {
    const moved = retarget(draft, ['docs'], steps);
    expect(moved.pipeline).toBe('docs');
    expect(moved.skip).toEqual([]);
  });

  it('does not send the repository with the fields', () => {
    expect(fieldsOf(draft)).not.toHaveProperty('repository');
  });
});

const APP = '/work/app';
const LIB = '/work/lib';

/** A panel started in /work/app that knows a second repository, /work/lib. */
function twoRepositories(
  options: { libPipelines?: string[]; libPipelinesLate?: boolean; runs?: RunView[] } = {},
) {
  const libIds = options.libPipelines ?? ['docs'];
  let release: (() => void) | undefined;
  const libView = pipelinesView({
    repository: LIB,
    pipelines: libIds.map((id) => pipelineOf({ id })),
  });
  const appQueue = queueOf({ repository: APP, items: [queueItem('qa', 'app task', 1)] });
  const api = fakeApi({
    queue: vi.fn(async () => appQueue),
    runs: vi.fn(async () => []),
    pipelines: vi.fn(async (repository?: string) => {
      if (repository !== LIB) return pipelinesView({ repository: APP });
      if (options.libPipelinesLate)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return libView;
    }),
    queueAdd: vi.fn(async () => ({
      ...queueOf({ repository: LIB, autoDeliver: false, items: [queueItem('ql', 'lib task', 7)] }),
      item: 'ql',
    })),
  });
  const queues: QueueView[] = [
    appQueue,
    queueOf({ repository: LIB, autoDeliver: false, items: [queueItem('ql0', 'lib old', 3)] }),
  ];
  render(<App api={api as Api} openStream={openFake} />);
  act(() => {
    FakeEventSource.last?.send({
      event: 'snapshot',
      seq: 1,
      runs: options.runs ?? [runView({ id: 'a1', repository: APP })],
      queues,
      repositories: [repositoryView(APP), repositoryView(LIB)],
    });
  });
  return { api, release: () => release?.() };
}

async function openDialog() {
  const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  return screen.findByRole('dialog', { name: 'New task' });
}

async function pickLib(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('combobox', { name: 'Repository' }));
  fireEvent.click(await screen.findByRole('option', { name: /lib/ }));
  await waitFor(() =>
    expect(within(dialog).getByRole('combobox', { name: 'Repository' }).textContent).toContain(
      'lib',
    ),
  );
}

describe('repository of the new task', () => {
  it('is the first field of the left half and defaults to the repository of the top bar', async () => {
    twoRepositories();
    const dialog = await openDialog();
    const picker = within(dialog).getByRole('combobox', { name: 'Repository' });
    expect(picker.textContent).toContain('app');
    expect(picker.getAttribute('title')).toBe(APP);
    const name = within(dialog).getByPlaceholderText('Name (optional)');
    expect(picker.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(picker.closest('fieldset')).toBe(name.closest('fieldset'));
  });

  it('adds the task to the chosen repository and leaves the panel where it was', async () => {
    const { api } = twoRepositories();
    const dialog = await openDialog();
    const hash = window.location.hash;
    await pickLib(dialog);
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('docs'),
    );
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'doc it' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByText('Task #7 created').length).toBeGreaterThan(0));
    expect(api.calls.filter(([name]) => name === 'queueAdd')).toEqual([['queueAdd', LIB]]);
    expect(api.queueAdd).toHaveBeenCalledWith(expect.objectContaining({ task: 'doc it' }));
    expect(window.location.hash).toBe(hash);
    expect(document.querySelector('[data-repository-trigger]')?.getAttribute('aria-label')).toBe(
      'Repository: app',
    );
  });

  it('keeps the postpone switch when the repository changes', async () => {
    const { api } = twoRepositories();
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Postpone' }));
    await pickLib(dialog);
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('docs'),
    );
    expect(
      within(dialog).getByRole('switch', { name: 'Postpone' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'later' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByText('Task #7 created').length).toBeGreaterThan(0));
    expect(api.calls.filter(([name]) => name === 'queueAdd')).toEqual([['queueAdd', LIB]]);
    expect(api.queueAdd).toHaveBeenCalledWith(expect.objectContaining({ postponed: true }));
  });

  it('keeps the pipeline the chosen repository has', async () => {
    twoRepositories({ libPipelines: ['docs', 'feature'] });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'text' } });
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe(
        'feature',
      ),
    );
    await pickLib(dialog);
    const add = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' });
    await waitFor(() => expect(add.disabled).toBe(false));
    expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature');
  });

  it('replaces a pipeline the chosen repository lacks with its first one', async () => {
    twoRepositories({ libPipelines: ['docs'] });
    const other = await openDialog();
    fireEvent.change(within(other).getByLabelText('Task text'), { target: { value: 'text' } });
    await waitFor(() =>
      expect(within(other).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    await pickLib(other);
    await waitFor(() =>
      expect(within(other).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('docs'),
    );
  });

  it('clears the links and keeps the text, the name and the tags', async () => {
    twoRepositories();
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'keep me' } });
    fireEvent.change(within(dialog).getByPlaceholderText('Name (optional)'), {
      target: { value: 'my name' },
    });
    const after = within(dialog).getByRole('combobox', { name: 'Waits for' });
    fireEvent.click(after);
    fireEvent.click(await screen.findByRole('option', { name: /app task/ }));
    await waitFor(() => expect(within(dialog).getAllByText(/app task/).length).toBeGreaterThan(0));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    // the closed popover hands the focus back to its trigger on a timer; a select opened before
    // that would lose the focus and close
    await waitFor(() => {
      expect(after.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(after);
    });
    await pickLib(dialog);
    await waitFor(() => expect(within(dialog).queryByText(/app task/)).toBeNull());
    expect((within(dialog).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe(
      'keep me',
    );
    expect((within(dialog).getByPlaceholderText('Name (optional)') as HTMLInputElement).value).toBe(
      'my name',
    );
  }, 10_000);

  it('takes the delivery defaults of the chosen repository', async () => {
    twoRepositories();
    const dialog = await openDialog();
    const auto = within(dialog).getByRole('switch', { name: 'Auto delivery' });
    expect(auto.getAttribute('aria-checked')).toBe('true');
    await pickLib(dialog);
    await waitFor(() =>
      expect(
        within(dialog).getByRole('switch', { name: 'Auto delivery' }).getAttribute('aria-checked'),
      ).toBe('false'),
    );
  });

  it('keeps Add disabled until the pipelines of the chosen repository are loaded', async () => {
    const { release } = twoRepositories({ libPipelinesLate: true });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'text' } });
    const add = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' });
    await waitFor(() => expect(add.disabled).toBe(false));
    await pickLib(dialog);
    expect(add.disabled).toBe(true);
    release();
    await waitFor(() => expect(add.disabled).toBe(false));
  });

  it('opens again on the repository of the top bar with the text kept', async () => {
    twoRepositories();
    const dialog = await openDialog();
    await pickLib(dialog);
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'draft' } });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    const again = await openDialog();
    await waitFor(() =>
      expect(within(again).getByRole('combobox', { name: 'Repository' }).textContent).toContain(
        'app',
      ),
    );
    expect((within(again).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('draft');
  });
});

describe('subtask from the run header', () => {
  const finished = runView({
    id: 'a1',
    repository: APP,
    number: 115,
    title: 'Вход по ссылке',
    finished: true,
    state: 'finished',
    finishedAt: 5_000,
  });
  const parentField = (dialog: HTMLElement) =>
    within(dialog).getByRole('combobox', { name: 'Parent task' });

  async function createSubtask() {
    const more = await screen.findByRole('button', { name: 'More' });
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Create subtask…' }));
    return screen.findByRole('dialog', { name: 'New task' });
  }

  const close = async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
  };

  it('opens the dialog with the finished run as the parent and sends it', async () => {
    const { api } = twoRepositories({ runs: [finished] });
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Вход по ссылке'));
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'child' } });
    await waitFor(() =>
      expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'child', parent: 'a1' }),
      ),
    );
  });

  it('keeps the text typed in the dialog before', async () => {
    twoRepositories({ runs: [finished] });
    const first = await openDialog();
    fireEvent.change(within(first).getByLabelText('Task text'), { target: { value: 'kept' } });
    await close();
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Вход по ссылке'));
    expect((within(dialog).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('kept');
  });

  it('moves a draft typed for another repository and sets the parent', async () => {
    twoRepositories({ runs: [finished] });
    const first = await openDialog();
    await pickLib(first);
    fireEvent.change(within(first).getByLabelText('Task text'), { target: { value: 'for lib' } });
    await waitFor(() =>
      expect(within(first).getByRole('combobox', { name: 'Waits for' }).textContent).toBeDefined(),
    );
    fireEvent.click(within(first).getByRole('combobox', { name: 'Waits for' }));
    fireEvent.click(await screen.findByRole('option', { name: /lib old/ }));
    await waitFor(() => expect(within(first).getAllByText(/lib old/).length).toBeGreaterThan(0));
    fireEvent.keyDown(document.activeElement ?? first, { key: 'Escape' });
    await close();
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Вход по ссылке'));
    expect(within(dialog).getByRole('combobox', { name: 'Repository' }).textContent).toContain(
      'app',
    );
    expect((within(dialog).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe(
      'for lib',
    );
    expect(within(dialog).queryByText(/lib old/)).toBeNull();
  });

  it('keeps the parent when queue and run events arrive while the dialog is open', async () => {
    twoRepositories({ runs: [finished] });
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Вход по ссылке'));
    act(() => {
      FakeEventSource.last?.send({
        event: 'queue',
        queue: queueOf({ repository: APP, items: [queueItem('qa', 'app task', 1)] }),
      });
      FakeEventSource.last?.send({ event: 'run', run: { ...finished, title: 'Вход' } });
    });
    expect(parentField(dialog).textContent).toMatch(/^#115 /);
  });

  it('opens on the repository of a run of another repository and keeps it', async () => {
    const libRun = runView({
      id: 'l1',
      repository: LIB,
      number: 42,
      title: 'Библиотека',
      finished: true,
      state: 'finished',
      finishedAt: 6_000,
    });
    const { api } = twoRepositories({ runs: [libRun] });
    fireEvent.click(await screen.findByRole('radio', { name: 'All repositories' }));
    fireEvent.click(await screen.findByText('Библиотека'));
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#42 Библиотека'));
    await waitFor(() => expect(api.pipelines).toHaveBeenCalledWith(LIB));
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('docs'),
    );
    expect(within(dialog).getByRole('combobox', { name: 'Repository' }).textContent).toContain(
      'lib',
    );
    expect(parentField(dialog).textContent).toBe('#42 Библиотека');
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'child' } });
    await waitFor(() =>
      expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith(expect.objectContaining({ parent: 'l1' })),
    );
    expect(api.calls.filter(([name]) => name === 'queueAdd')).toEqual([['queueAdd', LIB]]);
  });

  it('lets the parent be removed and does not set it again on a plain New task', async () => {
    const { api } = twoRepositories({ runs: [finished] });
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Вход по ссылке'));
    fireEvent.click(parentField(dialog));
    fireEvent.click(await screen.findByRole('option', { name: 'No parent task' }));
    await waitFor(() => expect(parentField(dialog).textContent).toBe('No parent task'));
    // an event of a run while the dialog is open does not bring the parent back
    act(() => {
      FakeEventSource.last?.send({ event: 'run', run: { ...finished, title: 'Вход' } });
    });
    expect(parentField(dialog).textContent).toBe('No parent task');
    await close();
    const again = await openDialog();
    expect(parentField(again).textContent).toBe('No parent task');
    fireEvent.change(within(again).getByLabelText('Task text'), { target: { value: 'plain' } });
    await waitFor(() =>
      expect(within(again).getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(within(again).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect(vi.mocked(api.queueAdd).mock.calls[0]![0]).not.toHaveProperty('parent');
  });
});

describe('markdown field of the new task', () => {
  async function openDialog(api = fakeApi({ queue: vi.fn(async () => queueOf()) })) {
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    return { api, dialog };
  }

  function paste(target: HTMLElement, data: Record<string, string>) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => data[type] ?? '' },
    });
    fireEvent(target, event);
    return event;
  }

  it('shows the text as Markdown in the preview and keeps the draft', async () => {
    const { api, dialog } = await openDialog();
    const text = '# Заголовок\n\n- [x] готово\n\n**жирный**';
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: text } });
    previewMarkdown(dialog);
    expect(within(dialog).getByRole('heading', { name: 'Заголовок' })).toBeTruthy();
    expect(within(dialog).getByText('жирный').tagName).toBe('STRONG');
    expect(within(dialog).getByRole<HTMLInputElement>('checkbox').checked).toBe(true);
    previewMarkdown(dialog, false);
    expect((within(dialog).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe(text);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect(vi.mocked(api.queueAdd).mock.calls[0]![0]).toMatchObject({ task: text });
  });

  const MARKS = [
    'Heading',
    'Bold',
    'Italic',
    'Strikethrough',
    'Bulleted list',
    'Numbered list',
    'Task list',
    'Quote',
    'Code',
    'Code block',
    'Link',
  ];

  it('starts on Plain with the markup buttons and the preview unavailable', async () => {
    const { dialog } = await openDialog();
    const bar = within(dialog).getByRole('toolbar', { name: 'Text formatting' });
    const first = bar.querySelector('button, [role="radio"]');
    expect(first?.textContent).toBe('Plain');
    expect(within(bar).getByRole('radio', { name: 'Plain' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    for (const name of [...MARKS, 'Preview']) {
      const button = within(bar).getByRole<HTMLButtonElement>('button', { name });
      expect(button.disabled).toBe(true);
    }
    expect(within(bar).getByRole('button', { name: 'Bold' }).getAttribute('title')).toBe(
      'Bold (switch to MD)',
    );
    expect(bar.lastElementChild?.textContent).toBe('Preview');
  });

  it('enables the buttons on MD and takes them away again on Plain from the preview', async () => {
    const { dialog } = await openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'MD' }));
    for (const name of [...MARKS, 'Preview']) {
      expect(within(dialog).getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(false);
    }
    const area = within(dialog).getByLabelText<HTMLTextAreaElement>('Task text');
    fireEvent.change(area, { target: { value: '# Итог' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(area.hidden).toBe(true);
    expect(
      within(dialog).getByRole('button', { name: 'Preview' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Bold' }).disabled).toBe(
      true,
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Plain' }));
    expect(area.hidden).toBe(false);
    expect(within(dialog).queryByRole('heading', { name: 'Итог' })).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: 'Preview' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(area.value).toBe('# Итог');
  });

  it('puts the markup of a button into the draft and keeps the selection in the field', async () => {
    const { api, dialog } = await openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'MD' }));
    const area = within(dialog).getByLabelText<HTMLTextAreaElement>('Task text');
    fireEvent.change(area, { target: { value: 'раз два' } });
    area.setSelectionRange(0, 3);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bold' }));
    expect(area.value).toBe('**раз** два');
    expect([area.selectionStart, area.selectionEnd]).toEqual([2, 5]);
    expect(document.activeElement).toBe(area);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bulleted list' }));
    expect(area.value).toBe('- **раз** два');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bulleted list' }));
    expect(area.value).toBe('**раз** два');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quote' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect(vi.mocked(api.queueAdd).mock.calls[0]![0]).toMatchObject({ task: '> **раз** два' });
  });

  it('pastes formatted text on Plain as Markdown', async () => {
    const { dialog } = await openDialog();
    const area = within(dialog).getByLabelText<HTMLTextAreaElement>('Task text');
    const event = paste(area, { 'text/html': '<strong>важно</strong>', 'text/plain': 'важно' });
    expect(event.defaultPrevented).toBe(true);
    expect(area.value).toBe('**важно**');
  });

  it('shows HTML in the text as text', async () => {
    const { dialog } = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Task text'), {
      target: { value: '<img src=x alt="pic"> тут' },
    });
    previewMarkdown(dialog);
    expect(dialog.querySelector('img')).toBeNull();
    expect(
      within(dialog)
        .getAllByText(/<img src=x/)
        .some((el) => el.tagName === 'P'),
    ).toBe(true);
  });

  it('says there is nothing to preview for an empty text', async () => {
    const { dialog } = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: '  ' } });
    previewMarkdown(dialog);
    expect(within(dialog).getByText('Nothing to preview')).toBeTruthy();
  });

  it('opens on Plain with the focus in the field after a preview', async () => {
    const { dialog } = await openDialog();
    previewMarkdown(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    fireEvent.click(strip().getByRole('button', { name: 'New task' }));
    const again = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(again).getByRole('radio', { name: 'Plain' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await waitFor(() => expect(document.activeElement?.id).toBe('new-task'));
  });

  it('keeps one stop of the Tab key on the toolbar', async () => {
    const { dialog } = await openDialog();
    const bar = within(dialog).getByRole('toolbar', { name: 'Text formatting' });
    // the roving focus makes the bar itself the only stop until focus enters it
    const items = [...bar.querySelectorAll('button, [role="radio"]')];
    expect(items.length).toBeGreaterThan(1);
    expect(items.every((item) => item.getAttribute('tabindex') !== '0')).toBe(true);
    expect(bar.getAttribute('tabindex')).toBe('0');
  });

  it('has an independent toolbar for the text of every group', async () => {
    const { dialog } = await openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Groups' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add group' }));
    const second = within(dialog).getByLabelText('Text of group 2').closest('fieldset')!;
    const first = within(dialog).getByLabelText('Text of group 1').closest('fieldset')!;
    fireEvent.change(within(first).getByLabelText('Text of group 1'), {
      target: { value: '## Раздел' },
    });
    fireEvent.change(within(second).getByLabelText('Text of group 2'), {
      target: { value: '## Второй' },
    });
    previewMarkdown(second);
    expect(within(second).getByRole('heading', { name: 'Второй' })).toBeTruthy();
    expect(within(first).queryByRole('heading')).toBeNull();
    expect(within(first).getByRole('radio', { name: 'Plain' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(within(first).getByLabelText<HTMLTextAreaElement>('Text of group 1').hidden).toBe(false);
    previewMarkdown(first);
    expect(within(first).getByRole('heading', { name: 'Раздел' })).toBeTruthy();
  });

  it('pastes formatted text into the middle of the text as Markdown', async () => {
    const { api, dialog } = await openDialog();
    const area = within(dialog).getByLabelText('Task text') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'до после' } });
    area.setSelectionRange(3, 3);
    const event = paste(area, {
      'text/html': '<h2>Итог</h2><ul><li>раз</li><li>два</li></ul>',
      'text/plain': 'Итог раз два',
    });
    expect(event.defaultPrevented).toBe(true);
    const md = '## Итог\n\n- раз\n- два';
    expect(area.value).toBe(`до ${md}после`);
    expect(area.selectionStart).toBe(3 + md.length);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect(vi.mocked(api.queueAdd).mock.calls[0]![0]).toMatchObject({ task: `до ${md}после` });
  });

  it('leaves Markdown source and plain text to the browser', async () => {
    const { dialog } = await openDialog();
    const area = within(dialog).getByLabelText('Task text') as HTMLTextAreaElement;
    const plain = paste(area, { 'text/plain': '# Заголовок\n- пункт' });
    expect(plain.defaultPrevented).toBe(false);
    const code = paste(area, {
      'text/html': '<div><span># Заголовок</span></div><div><span>- пункт</span></div>',
      'text/plain': '# Заголовок\n- пункт',
    });
    expect(code.defaultPrevented).toBe(false);
    expect(area.value).toBe('');
  });

  it('pastes formatted text into the text of a group', async () => {
    const { dialog } = await openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Groups' }));
    const area = within(dialog).getByLabelText('Text of group 1') as HTMLTextAreaElement;
    paste(area, { 'text/html': '<p>см. <a href="https://e.com">сайт</a></p>' });
    expect(area.value).toBe('см. [сайт](https://e.com)');
  });
});

describe('add and continue', () => {
  const added = () =>
    vi.fn(async () => ({
      ...queueOf({ items: [queueItem('q12', 'First', 12)] }),
      item: 'q12',
    }));

  async function openDialog(api: Api) {
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    return dialog;
  }

  it('stands after "Add" and is disabled while the task is empty', async () => {
    const dialog = await openDialog(fakeApi({ queue: vi.fn(async () => queueOf()) }));
    const names = within(dialog)
      .getAllByRole('button')
      .map((item) => item.textContent);
    expect(names.indexOf('Add and continue')).toBe(names.indexOf('Add') + 1);
    const next = within(dialog).getByRole<HTMLButtonElement>('button', {
      name: 'Add and continue',
    });
    expect(next.disabled).toBe(true);
    expect(next.type).toBe('button');
  });

  it('sends the request of "Add", keeps the dialog and clears the text', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()), queueAdd: added() });
    const dialog = await openDialog(api);
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'First' } });
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'Do it' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and continue' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        title: 'First',
        task: 'Do it',
      }),
    );
    await waitFor(() => expect(screen.getAllByText('Task #12 created').length).toBeGreaterThan(0));
    const text = within(dialog).getByLabelText<HTMLTextAreaElement>('Task text');
    await waitFor(() => expect(text.value).toBe(''));
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe('');
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature');
    await waitFor(() => expect(document.activeElement).toBe(text));
  });

  it('leaves one empty group and focuses its title in the groups mode', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()), queueAdd: added() });
    const dialog = await openDialog(api);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Groups' }));
    fireEvent.change(within(dialog).getByLabelText('Title of group 1'), {
      target: { value: 'One' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add group' }));
    fireEvent.change(within(dialog).getByLabelText('Text of group 2'), {
      target: { value: 'Two' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and continue' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        groups: [
          { title: 'One', task: 'One' },
          { title: 'Two', task: 'Two' },
        ],
      }),
    );
    const title = await within(dialog).findByLabelText<HTMLInputElement>('Title of group 1');
    await waitFor(() => expect(title.value).toBe(''));
    expect(within(dialog).queryByLabelText('Title of group 2')).toBeNull();
    expect(within(dialog).getByRole('radio', { name: 'Groups' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('keeps the dialog, the text and the error when the server rejects it', async () => {
    const api = fakeApi({
      queue: vi.fn(async () => queueOf()),
      queueAdd: vi.fn(async () => {
        throw new Error('rejected');
      }),
    });
    const dialog = await openDialog(api);
    const shown = screen.queryAllByText('Task #12 created').length;
    const created = screen.queryAllByText('Task created').length;
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'Keep' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and continue' }));
    await waitFor(() => expect(within(dialog).getByText('rejected')).toBeTruthy());
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Task text').value).toBe('Keep');
    expect(api.queueAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    expect(screen.queryAllByText('Task #12 created')).toHaveLength(shown);
    expect(screen.queryAllByText('Task created')).toHaveLength(created);
  });

  const auth = { id: 'ta', repository: '/repo', name: 'auth', color: 'red' as const, task: null };

  /** Fills the dialog: a tag, a parent, a predecessor, "Postpone" and the text. */
  async function fillSettings(dialog: HTMLElement) {
    act(() => {
      FakeEventSource.last?.open();
      FakeEventSource.last?.send({
        event: 'snapshot',
        seq: 1,
        runs: [runView()],
        tags: [auth],
      });
    });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'First' } });
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'Do it' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Postpone' }));
    choose(within(dialog).getByRole('combobox', { name: 'Parent task' }), /добавить вход/);
    for (const [name, option] of [
      ['Tags', 'auth'],
      ['Waits for', /Old/],
    ] as const) {
      const field = await within(dialog).findByRole('combobox', { name });
      fireEvent.click(field);
      fireEvent.click(await screen.findByRole('option', { name: option }));
      fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
      await waitFor(() => {
        expect(field.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(field);
      });
    }
  }

  const withOld = () =>
    fakeApi({
      queue: vi.fn(async () => queueOf({ items: [queueItem('q1', 'Old', 1)] })),
      queueAdd: added(),
    });

  it('sends the same request as "Add" and keeps tag, parent and postpone, but not "Waits for"', async () => {
    const api = withOld();
    const dialog = await openDialog(api);
    await fillSettings(dialog);
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Parent task' }).textContent).toMatch(
        /добавить вход/,
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and continue' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(api.queueAdd).mock.calls[0]![0];
    expect(sent).toMatchObject({
      title: 'First',
      task: 'Do it',
      tags: ['auth'],
      parent: 'run1',
      after: ['q1'],
      postponed: true,
    });
    await waitFor(() =>
      expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Task text').value).toBe(''),
    );
    expect(within(dialog).getAllByText('auth').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('combobox', { name: 'Parent task' }).textContent).toMatch(
      /добавить вход/,
    );
    expect(
      within(dialog).getByRole('switch', { name: 'Postpone' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(within(dialog).getByRole('combobox', { name: 'Waits for' }).textContent).not.toMatch(
      /Old/,
    );

    // the same input through "Add" gives the same request
    cleanup();
    const plain = withOld();
    const again = await openDialog(plain);
    await fillSettings(again);
    await waitFor(() =>
      expect(within(again).getByRole('combobox', { name: 'Parent task' }).textContent).toMatch(
        /добавить вход/,
      ),
    );
    fireEvent.click(within(again).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(plain.queueAdd).toHaveBeenCalledTimes(1));
    expect(vi.mocked(plain.queueAdd).mock.calls[0]![0]).toEqual(sent);
  }, 15_000);

  it('offers the added task among the tasks to wait for', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()), queueAdd: added() });
    const dialog = await openDialog(api);
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'Do it' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and continue' }));
    await waitFor(() => expect(screen.getAllByText('Task #12 created').length).toBeGreaterThan(0));
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Waits for' }));
    expect(await screen.findByRole('option', { name: /#12/ })).toBeTruthy();
  });

  it('disables both buttons until the request is done', async () => {
    let finish: (value: Awaited<ReturnType<Api['queueAdd']>>) => void = () => {};
    const api = fakeApi({
      queue: vi.fn(async () => queueOf()),
      queueAdd: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<Api['queueAdd']>>>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const dialog = await openDialog(api);
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'Do it' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and continue' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(
      true,
    );
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add and continue' }).disabled,
    ).toBe(true);
    await act(async () => {
      finish({ ...queueOf({ items: [queueItem('q12', 'First', 12)] }), item: 'q12' });
    });
    await waitFor(() => expect(screen.getAllByText('Task #12 created').length).toBeGreaterThan(0));
  });
});
