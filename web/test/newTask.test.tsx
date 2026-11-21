// @vitest-environment jsdom
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { emptyDraft, fieldsOf, retarget } from '../src/features/queue/QueueForm.tsx';
import { defaultSharedTag } from '../src/features/queue/form/sharedTag.ts';
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
import { chooseKind } from './linkKind.ts';
import {
  FakeSocket,
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
      FakeSocket.last!.open();
      FakeSocket.last!.send({ event: 'queue', seq: 1, queue: queueOf() });
      FakeSocket.last!.send({ event: 'run', seq: 2, run: runView() });
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
        ...queueOf({ items: [queueItem('q12', 'Build sign-in', 12)] }),
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
      target: { value: 'Build sign-in' },
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
    fireEvent.change(within(dialog).getByLabelText('Task text'), {
      target: { value: 'rough draft' },
    });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    window.location.hash = '#queue';
    const controls = await screen.findByRole('region', { name: 'queue controls' });
    fireEvent.click(within(controls).getByRole('button', { name: 'New task' }));
    const again = await screen.findByRole('dialog', { name: 'New task' });
    expect((within(again).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe(
      'rough draft',
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
    fireEvent.click(field.getByRole('button', { name: 'Add link' }));
    expect(field.getByRole('combobox', { name: 'Link kind' }).className).toContain('h-9.5');
    expect(field.getByRole('combobox', { name: 'Linked task' }).className).toContain('h-9.5');
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
    links: [
      { kind: 'blocked_by' as const, target: 'q1' },
      { kind: 'parent' as const, target: 'run1' },
    ],
    linksTouched: true,
    skip: ['plan', 'review'],
    repository: '/work/app',
  };

  it('keeps a pipeline the new repository has and clears the links', () => {
    const moved = retarget(draft, ['docs', 'feature'], steps);
    expect(moved.pipeline).toBe('feature');
    expect(moved.links).toEqual([]);
    expect(moved.linksTouched).toBe(false);
    expect(moved.skip).toEqual(['plan']);
    expect([moved.title, moved.task, moved.tags, moved.autoDeliver]).toEqual([
      'name',
      'text',
      ['t1'],
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
const appTag = {
  id: 'app-tag',
  name: 'app-tag',
  repository: APP,
  color: 'red' as const,
  task: null,
};
const libTag = {
  id: 'lib-tag',
  name: 'lib-tag',
  repository: LIB,
  color: 'blue' as const,
  task: null,
};

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
    FakeSocket.last?.send({
      event: 'snapshot',
      seq: 1,
      runs: options.runs ?? [runView({ id: 'a1', repository: APP })],
      queues,
      tags: [appTag, libTag],
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
    const tags = within(dialog).getByRole('combobox', { name: 'Tags' });
    fireEvent.click(tags);
    fireEvent.click(await screen.findByRole('option', { name: 'app-tag' }));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => expect(tags.getAttribute('aria-expanded')).toBe('false'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    const after = within(dialog).getByRole('combobox', { name: 'Linked task' });
    fireEvent.click(after);
    fireEvent.click(await screen.findByRole('option', { name: /app task/ }));
    await waitFor(() => expect(within(dialog).getAllByText(/app task/).length).toBeGreaterThan(0));
    // the closed popover hands the focus back to its trigger on a timer; a select opened before
    // that would lose the focus and close
    await waitFor(() => {
      expect(after.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(after);
    });
    await pickLib(dialog);
    await waitFor(() => expect(within(dialog).queryByText(/app task/)).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Remove tag app-tag' })).toBeTruthy();
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

  it('blocks submission during retargeting and clears prior links once the new repository loads', async () => {
    const { api, release } = twoRepositories({ libPipelinesLate: true });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Task text'), {
      target: { value: 'keep text' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    const task = within(dialog).getByRole('combobox', { name: 'Linked task' });
    fireEvent.click(task);
    fireEvent.click(await screen.findByRole('option', { name: /app task/ }));
    await waitFor(() => {
      expect(task.textContent).toContain('app task');
      expect(document.activeElement).toBe(task);
    });
    await pickLib(dialog);
    const add = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' });
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(api.queueAdd).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(add.disabled).toBe(false));
    expect(within(dialog).queryByRole('combobox', { name: 'Linked task' })).toBeNull();
    fireEvent.click(add);
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect(vi.mocked(api.queueAdd).mock.calls[0]![0]).not.toHaveProperty('links');
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
    title: 'Sign-in by link',
    finished: true,
    state: 'finished',
    finishedAt: 5_000,
  });
  const parentField = (dialog: HTMLElement) =>
    within(dialog).getByRole('combobox', { name: 'Linked task' });

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
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Sign-in by link'));
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'child' } });
    await waitFor(() =>
      expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'child', links: [{ kind: 'parent', target: 'a1' }] }),
      ),
    );
  });

  it('keeps the text typed in the dialog before', async () => {
    twoRepositories({ runs: [finished] });
    const first = await openDialog();
    fireEvent.change(within(first).getByLabelText('Task text'), { target: { value: 'kept' } });
    await close();
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Sign-in by link'));
    expect((within(dialog).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('kept');
  });

  it('keeps the preset parent after add and continue', async () => {
    const { api } = twoRepositories({ runs: [finished] });
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Sign-in by link'));
    fireEvent.change(within(dialog).getByLabelText('Task text'), {
      target: { value: 'first child' },
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add and continue' })
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and continue' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith(
        expect.objectContaining({ links: [{ kind: 'parent', target: 'a1' }] }),
      ),
    );
    await waitFor(() =>
      expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Task text').value).toBe(''),
    );
    expect(parentField(dialog).textContent).toBe('#115 Sign-in by link');
  });

  it('moves a draft typed for another repository and sets the parent', async () => {
    twoRepositories({ runs: [finished] });
    const first = await openDialog();
    await pickLib(first);
    fireEvent.change(within(first).getByLabelText('Task text'), { target: { value: 'for lib' } });
    const tags = within(first).getByRole('combobox', { name: 'Tags' });
    fireEvent.click(tags);
    fireEvent.click(await screen.findByRole('option', { name: 'lib-tag' }));
    fireEvent.keyDown(document.activeElement ?? first, { key: 'Escape' });
    await waitFor(() => expect(tags.getAttribute('aria-expanded')).toBe('false'));
    fireEvent.click(within(first).getByRole('button', { name: 'Add link' }));
    fireEvent.click(within(first).getByRole('combobox', { name: 'Linked task' }));
    fireEvent.click(await screen.findByRole('option', { name: /lib old/ }));
    await waitFor(() => expect(within(first).getAllByText(/lib old/).length).toBeGreaterThan(0));
    await close();
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Sign-in by link'));
    expect(within(dialog).getByRole('combobox', { name: 'Repository' }).textContent).toContain(
      'app',
    );
    expect((within(dialog).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe(
      'for lib',
    );
    expect(within(dialog).queryByText(/lib old/)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Remove tag lib-tag' })).toBeNull();
  });

  it('keeps the parent when queue and run events arrive while the dialog is open', async () => {
    twoRepositories({ runs: [finished] });
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Sign-in by link'));
    act(() => {
      FakeSocket.last?.send({
        event: 'queue',
        queue: queueOf({ repository: APP, items: [queueItem('qa', 'app task', 1)] }),
      });
      FakeSocket.last?.send({ event: 'run', run: { ...finished, title: 'Sign-in' } });
    });
    expect(parentField(dialog).textContent).toMatch(/^#115 /);
  });

  it('opens on the repository of a run of another repository and keeps it', async () => {
    const libRun = runView({
      id: 'l1',
      repository: LIB,
      number: 42,
      title: 'Library',
      finished: true,
      state: 'finished',
      finishedAt: 6_000,
    });
    const { api } = twoRepositories({ runs: [libRun] });
    const menu = await screen.findByRole('button', { name: /Repository:/ });
    fireEvent.keyDown(menu, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'All projects' }));
    // the list of all projects opens its first run
    await waitFor(() => expect(window.location.hash).toBe('#runs/l1'));
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#42 Library'));
    await waitFor(() => expect(api.pipelines).toHaveBeenCalledWith(LIB));
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('docs'),
    );
    expect(within(dialog).getByRole('combobox', { name: 'Repository' }).textContent).toContain(
      'lib',
    );
    expect(parentField(dialog).textContent).toBe('#42 Library');
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'child' } });
    await waitFor(() =>
      expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith(
        expect.objectContaining({ links: [{ kind: 'parent', target: 'l1' }] }),
      ),
    );
    expect(api.calls.filter(([name]) => name === 'queueAdd')).toEqual([['queueAdd', LIB]]);
  });

  it('lets the parent be removed and does not set it again on a plain New task', async () => {
    const { api } = twoRepositories({ runs: [finished] });
    const dialog = await createSubtask();
    await waitFor(() => expect(parentField(dialog).textContent).toBe('#115 Sign-in by link'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove link' }));
    expect(within(dialog).queryByRole('combobox', { name: 'Linked task' })).toBeNull();
    // an event of a run while the dialog is open does not bring the parent back
    act(() => {
      FakeSocket.last?.send({ event: 'run', run: { ...finished, title: 'Sign-in' } });
    });
    expect(within(dialog).queryByRole('combobox', { name: 'Linked task' })).toBeNull();
    await close();
    const again = await openDialog();
    expect(within(again).queryByRole('combobox', { name: 'Linked task' })).toBeNull();
    fireEvent.change(within(again).getByLabelText('Task text'), { target: { value: 'plain' } });
    await waitFor(() =>
      expect(within(again).getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(within(again).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect(vi.mocked(api.queueAdd).mock.calls[0]![0]).not.toHaveProperty('links');
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
    const text = '# Overview\n\n- [x] done\n\n**bold text**';
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: text } });
    previewMarkdown(dialog);
    expect(within(dialog).getByRole('heading', { name: 'Overview' })).toBeTruthy();
    expect(within(dialog).getByText('bold text').tagName).toBe('STRONG');
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

  it('starts on MD with the markup buttons and the preview available', async () => {
    const { dialog } = await openDialog();
    const bar = within(dialog).getByRole('toolbar', { name: 'Text formatting' });
    const first = bar.querySelector('button, [role="radio"]');
    expect(first?.textContent).toBe('Plain');
    expect(within(bar).getByRole('radio', { name: 'MD' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    for (const name of [...MARKS, 'Preview']) {
      const button = within(bar).getByRole<HTMLButtonElement>('button', { name });
      expect(button.disabled).toBe(false);
    }
    expect(bar.lastElementChild?.textContent).toBe('Preview');
  });

  it('puts the attachments right under the text of the task', async () => {
    const { dialog } = await openDialog();
    const area = within(dialog).getByLabelText('Task text');
    const files = within(dialog).getByTestId('new-attachments-input');
    expect(area.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const delivery = within(dialog).getByText('Delivery');
    expect(files.compareDocumentPosition(delivery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('takes the markup buttons away on Plain', async () => {
    const { dialog } = await openDialog();
    const bar = within(dialog).getByRole('toolbar', { name: 'Text formatting' });
    fireEvent.click(within(bar).getByRole('radio', { name: 'Plain' }));
    for (const name of [...MARKS, 'Preview']) {
      expect(within(bar).getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
    expect(within(bar).getByRole('button', { name: 'Bold' }).getAttribute('title')).toBe(
      'Bold (switch to MD)',
    );
  });

  it('enables the buttons on MD and takes them away again on Plain from the preview', async () => {
    const { dialog } = await openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'MD' }));
    for (const name of [...MARKS, 'Preview']) {
      expect(within(dialog).getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(false);
    }
    const area = within(dialog).getByLabelText<HTMLTextAreaElement>('Task text');
    fireEvent.change(area, { target: { value: '# Total' } });
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
    expect(within(dialog).queryByRole('heading', { name: 'Total' })).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: 'Preview' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(area.value).toBe('# Total');
  });

  it('puts the markup of a button into the draft and keeps the selection in the field', async () => {
    const { api, dialog } = await openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'MD' }));
    const area = within(dialog).getByLabelText<HTMLTextAreaElement>('Task text');
    fireEvent.change(area, { target: { value: 'one two' } });
    area.setSelectionRange(0, 3);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bold' }));
    expect(area.value).toBe('**one** two');
    expect([area.selectionStart, area.selectionEnd]).toEqual([2, 5]);
    expect(document.activeElement).toBe(area);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bulleted list' }));
    expect(area.value).toBe('- **one** two');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bulleted list' }));
    expect(area.value).toBe('**one** two');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quote' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect(vi.mocked(api.queueAdd).mock.calls[0]![0]).toMatchObject({ task: '> **one** two' });
  });

  it('pastes formatted text on Plain as Markdown', async () => {
    const { dialog } = await openDialog();
    const area = within(dialog).getByLabelText<HTMLTextAreaElement>('Task text');
    const event = paste(area, {
      'text/html': '<strong>important</strong>',
      'text/plain': 'important',
    });
    expect(event.defaultPrevented).toBe(true);
    expect(area.value).toBe('**important**');
  });

  it('shows HTML in the text as text', async () => {
    const { dialog } = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Task text'), {
      target: { value: '<img src=x alt="pic"> here' },
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

  it('opens on MD with the focus in the field after a preview', async () => {
    const { dialog } = await openDialog();
    previewMarkdown(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    fireEvent.click(strip().getByRole('button', { name: 'New task' }));
    const again = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(again).getByRole('radio', { name: 'MD' }).getAttribute('aria-checked')).toBe(
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
      target: { value: '## Section' },
    });
    fireEvent.change(within(second).getByLabelText('Text of group 2'), {
      target: { value: '## Second' },
    });
    previewMarkdown(second);
    expect(within(second).getByRole('heading', { name: 'Second' })).toBeTruthy();
    expect(within(first).queryByRole('heading')).toBeNull();
    expect(within(first).getByRole('radio', { name: 'MD' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(within(first).getByLabelText<HTMLTextAreaElement>('Text of group 1').hidden).toBe(false);
    previewMarkdown(first);
    expect(within(first).getByRole('heading', { name: 'Section' })).toBeTruthy();
  });

  it('pastes formatted text into the middle of the text as Markdown', async () => {
    const { api, dialog } = await openDialog();
    const area = within(dialog).getByLabelText('Task text') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'in out' } });
    area.setSelectionRange(3, 3);
    const event = paste(area, {
      'text/html': '<h2>Total</h2><ul><li>one</li><li>two</li></ul>',
      'text/plain': 'Total one two',
    });
    expect(event.defaultPrevented).toBe(true);
    const md = '## Total\n\n- one\n- two';
    expect(area.value).toBe(`in ${md}out`);
    expect(area.selectionStart).toBe(3 + md.length);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect(vi.mocked(api.queueAdd).mock.calls[0]![0]).toMatchObject({ task: `in ${md}out` });
  });

  it('leaves Markdown source and plain text to the browser', async () => {
    const { dialog } = await openDialog();
    const area = within(dialog).getByLabelText('Task text') as HTMLTextAreaElement;
    const plain = paste(area, { 'text/plain': '# Overview\n- item' });
    expect(plain.defaultPrevented).toBe(false);
    const code = paste(area, {
      'text/html': '<div><span># Overview</span></div><div><span>- item</span></div>',
      'text/plain': '# Overview\n- item',
    });
    expect(code.defaultPrevented).toBe(false);
    expect(area.value).toBe('');
  });

  it('pastes formatted text into the text of a group', async () => {
    const { dialog } = await openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Groups' }));
    const area = within(dialog).getByLabelText('Text of group 1') as HTMLTextAreaElement;
    paste(area, { 'text/html': '<p>see <a href="https://e.com">site</a></p>' });
    expect(area.value).toBe('see [site](https://e.com)');
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

  it('stands before "Add" and is disabled while the task is empty', async () => {
    const dialog = await openDialog(fakeApi({ queue: vi.fn(async () => queueOf()) }));
    const names = within(dialog)
      .getAllByRole('button')
      .map((item) => item.textContent);
    expect(names.indexOf('Add and continue') + 1).toBe(names.indexOf('Add'));
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
      FakeSocket.last?.open();
      FakeSocket.last?.send({
        event: 'snapshot',
        seq: 1,
        runs: [runView()],
        tags: [auth],
      });
    });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'First' } });
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'Do it' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Postpone' }));
    const tags = within(dialog).getByRole('combobox', { name: 'Tags' });
    fireEvent.click(tags);
    fireEvent.click(await screen.findByRole('option', { name: 'auth' }));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => expect(tags.getAttribute('aria-expanded')).toBe('false'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    await chooseKind(within(dialog).getByRole('combobox', { name: 'Link kind' }), 'Parent');
    const parent = within(dialog).getByRole('combobox', { name: 'Linked task' });
    fireEvent.click(parent);
    fireEvent.click(await screen.findByRole('option', { name: /add sign-in/ }));
    await waitFor(() => {
      expect(parent.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(parent);
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    fireEvent.click(within(dialog).getAllByRole('combobox', { name: 'Linked task' })[1]!);
    fireEvent.click(await screen.findByRole('option', { name: /Old/ }));
    await waitFor(() =>
      expect(
        within(dialog).getAllByRole('combobox', { name: 'Linked task' })[1]!.textContent,
      ).toContain('Old'),
    );
  }

  const withOld = () =>
    fakeApi({
      queue: vi.fn(async () => queueOf({ items: [queueItem('q1', 'Old', 1)] })),
      queueAdd: added(),
    });

  it('sends the same request as "Add" and keeps tag, parent row and postpone, but not the blocked-by rows"', async () => {
    const api = withOld();
    const dialog = await openDialog(api);
    await fillSettings(dialog);
    await waitFor(() =>
      expect(
        within(dialog).getAllByRole('combobox', { name: 'Linked task' })[0]!.textContent,
      ).toMatch(/add sign-in/),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and continue' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(api.queueAdd).mock.calls[0]![0];
    expect(sent).toMatchObject({
      title: 'First',
      task: 'Do it',
      tags: ['auth'],
      links: [
        { kind: 'parent', target: 'run1' },
        { kind: 'blocked_by', target: 'q1' },
      ],
      postponed: true,
    });
    await waitFor(() =>
      expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Task text').value).toBe(''),
    );
    expect(within(dialog).getAllByText('auth').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('combobox', { name: 'Linked task' }).textContent).toMatch(
      /add sign-in/,
    );
    expect(
      within(dialog).getByRole('switch', { name: 'Postpone' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(within(dialog).queryByText(/Old/)).toBeNull();

    // the same input through "Add" gives the same request
    cleanup();
    const plain = withOld();
    const again = await openDialog(plain);
    await fillSettings(again);
    await waitFor(() =>
      expect(
        within(again).getAllByRole('combobox', { name: 'Linked task' })[0]!.textContent,
      ).toMatch(/add sign-in/),
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Linked task' }));
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

describe('"Waits for" of a new task', () => {
  it('offers the waiting tasks of other projects in their own group', async () => {
    twoRepositories();
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Linked task' }));
    expect(await screen.findByRole('option', { name: /app task/ })).toBeTruthy();
    const other = await screen.findByRole('option', { name: /lib · .*lib old/ });
    expect(other).toBeTruthy();
    expect(screen.getByText('Other projects')).toBeTruthy();
    fireEvent.click(other);
    await waitFor(() =>
      expect(within(dialog).getAllByText(/lib · .*lib old/).length).toBeGreaterThan(0),
    );
  });
});

describe('new task in several projects', () => {
  function multiMount(
    options: {
      app?: string[];
      lib?: string[];
      add?: Api['queueAddProjects'];
    } = {},
  ) {
    const pipelinesOfIds = (ids: string[]) => ids.map((id) => pipelineOf({ id }));
    const api = fakeApi({
      queue: vi.fn(async () => queueOf({ repository: APP })),
      runs: vi.fn(async () => []),
      pipelines: vi.fn(async (repository?: string) =>
        repository === LIB
          ? pipelinesView({
              repository: LIB,
              pipelines: pipelinesOfIds(options.lib ?? ['feature']),
            })
          : pipelinesView({
              repository: APP,
              pipelines: pipelinesOfIds(options.app ?? ['feature']),
            }),
      ),
      ...(options.add ? { queueAddProjects: options.add } : {}),
    });
    render(<App api={api as Api} openStream={openFake} />);
    act(() => {
      FakeSocket.last?.send({
        event: 'snapshot',
        seq: 1,
        runs: [],
        queues: [queueOf({ repository: APP }), queueOf({ repository: LIB })],
        repositories: [repositoryView(APP), repositoryView(LIB)],
      });
    });
    return api;
  }

  async function openMulti() {
    const dialog = await openDialog();
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe(
        'feature',
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'In several projects' }));
    return dialog;
  }

  it('starts the properties column with Projects and has no tags section', async () => {
    multiMount();
    const dialog = await openMulti();
    const titles = within(dialog)
      .getAllByRole('group')
      .map((group) => group.querySelector(':scope > legend')?.textContent);
    expect(titles.indexOf('Projects')).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf('Projects')).toBeLessThan(titles.indexOf('Run'));
    expect(within(dialog).queryByRole('group', { name: 'Tags' })).toBeNull();
    expect(within(dialog).queryByRole('radio', { name: 'Groups' })).toBeNull();
  });

  async function clickAdd(dialog: HTMLElement) {
    const button = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
  }

  async function pickProject(dialog: HTMLElement, name: string) {
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Add project' }));
    const option = (await screen.findAllByRole('option')).find((item) =>
      item.textContent?.startsWith(name),
    );
    fireEvent.click(option!);
  }

  const projectNames = (dialog: HTMLElement) =>
    within(within(dialog).getByRole('list', { name: 'Order of the projects' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('span.truncate')?.textContent);

  it('adds the task to two projects with one request', async () => {
    const add = vi.fn(async () => [
      { repository: APP, project: 'app', item: 'q1', number: 1 },
      { repository: LIB, project: 'lib', item: 'q2', number: 1 },
    ]);
    const api = multiMount({ add });
    const dialog = await openMulti();
    // the project of the field is chosen first
    expect(projectNames(dialog)).toEqual(['app']);
    const addButton = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' });
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'Email' } });
    expect(addButton.disabled).toBe(true);
    expect(within(dialog).getAllByText('Choose at least two projects').length).toBeGreaterThan(0);
    await pickProject(dialog, 'lib');
    await waitFor(() => expect(addButton.disabled).toBe(false));
    fireEvent.click(addButton);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith({
      repositories: [APP, LIB],
      pipeline: 'feature',
      task: 'Email',
    });
    expect(api.queueAdd).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
  });

  it('changes the order of the projects and keeps the first one when the mode is switched off', async () => {
    const add = vi.fn(async () => []);
    multiMount({ add });
    const dialog = await openMulti();
    await pickProject(dialog, 'lib');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move lib up' }));
    const order = within(dialog).getByRole('list', { name: 'Order of the projects' });
    expect(
      within(order)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining('lib'), expect.stringContaining('app')]);
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'Email' } });
    await clickAdd(dialog);
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ repositories: [LIB, APP] }));
  });

  it('keeps the first chosen project when the mode is turned off', async () => {
    multiMount();
    const dialog = await openMulti();
    await pickProject(dialog, 'lib');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move lib up' }));
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Email' } });
    const toggle = within(dialog).getByRole('button', { name: 'In several projects' });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Repository' }).textContent).toContain(
        'lib',
      ),
    );
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Email');
  });

  it('drags a card only by its header row, not by the addition field', async () => {
    multiMount();
    const dialog = await openMulti();
    await pickProject(dialog, 'lib');
    let node: HTMLElement | null = within(dialog).getByLabelText('Addition for lib');
    while (node && node.tagName !== 'LI') {
      expect(node.getAttribute('draggable')).not.toBe('true');
      node = node.parentElement;
    }
    expect(node?.tagName).toBe('LI');
  });

  it('offers only the pipelines every chosen project has', async () => {
    multiMount({ app: ['feature', 'fix'], lib: ['feature', 'ui'] });
    const dialog = await openMulti();
    await pickProject(dialog, 'lib');
    fireEvent.keyDown(await within(dialog).findByRole('combobox', { name: 'Pipeline' }), {
      key: 'Enter',
    });
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['feature']);
  });

  it('says so when the projects have no pipeline in common and does not add', async () => {
    multiMount({ app: ['feature'], lib: ['docs'] });
    const dialog = await openMulti();
    await pickProject(dialog, 'lib');
    expect(
      await within(dialog).findByText('The selected projects have no pipeline in common'),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'x' } });
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(
      true,
    );
  });

  it('fills the shared tag from the title and sends the additions and the chain', async () => {
    const add = vi.fn(async () => []);
    multiMount({ add });
    const dialog = await openMulti();
    await pickProject(dialog, 'lib');
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Email in profile' },
    });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Shared tag').value).toBe(
      'Email in profile',
    );
    fireEvent.change(within(dialog).getByLabelText('Task text'), {
      target: { value: 'Email field' },
    });
    fireEvent.change(within(dialog).getByLabelText('Addition for lib'), {
      target: { value: 'Form' },
    });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'In turn' }));
    await clickAdd(dialog);
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith({
      repositories: [APP, LIB],
      pipeline: 'feature',
      task: 'Email field',
      title: 'Email in profile',
      notes: { [LIB]: 'Form' },
      tag: 'Email in profile',
      chain: true,
    });
  });

  it('keeps the tag the user typed and sends no tag when it is emptied', async () => {
    const add = vi.fn(async () => []);
    multiMount({ add });
    const dialog = await openMulti();
    await pickProject(dialog, 'lib');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Title' } });
    const tag = within(dialog).getByLabelText<HTMLInputElement>('Shared tag');
    fireEvent.change(tag, { target: { value: 'mine' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Other title' } });
    expect(tag.value).toBe('mine');
    fireEvent.change(tag, { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'x' } });
    await clickAdd(dialog);
    await waitFor(() => expect(add).toHaveBeenCalled());
    const [sent] = add.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(sent).not.toHaveProperty('tag');
    expect(sent).not.toHaveProperty('chain');
  });

  it('hides the groups, the attachments and the tags of the project', async () => {
    multiMount();
    const dialog = await openMulti();
    expect(within(dialog).queryByRole('radio', { name: 'Groups' })).toBeNull();
    expect(within(dialog).queryByText('Attachments')).toBeNull();
    expect(within(dialog).queryByText('Tags')).toBeNull();
    expect(within(dialog).queryByText('Parent task')).toBeNull();
  });

  it('puts the button in the title and shows the other view when it is pressed', async () => {
    multiMount();
    const dialog = await openDialog();
    const toggle = within(dialog).getByRole('button', { name: 'In several projects' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(within(dialog).queryByRole('switch', { name: 'In several projects' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'New task in several projects' })).toBeTruthy();
    expect(within(dialog).queryByRole('combobox', { name: 'Repository' })).toBeNull();
    expect(within(dialog).queryByRole('checkbox', { name: 'lib' })).toBeNull();
  });

  it('keeps the addition inside the card of the project', async () => {
    multiMount();
    const dialog = await openMulti();
    await pickProject(dialog, 'lib');
    const card = within(dialog).getByLabelText('Addition for lib').closest('li')!;
    expect(card.textContent).toContain('lib');
    expect(within(card).getByRole('button', { name: 'Remove lib' })).toBeTruthy();
  });

  it('offers only the projects not chosen yet and puts the new one last', async () => {
    multiMount();
    const dialog = await openMulti();
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Add project' }));
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]!.textContent).toContain('lib');
    fireEvent.click(options[0]!);
    expect(projectNames(dialog)).toEqual(['app', 'lib']);
    // every project is chosen: nothing to add
    expect(within(dialog).queryByRole('combobox', { name: 'Add project' })).toBeNull();
    expect(within(dialog).getByText('The task goes to 2 projects')).toBeTruthy();
  });

  it('removes a project and offers it again; the only project cannot be removed', async () => {
    multiMount();
    const dialog = await openMulti();
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Remove app' }).disabled,
    ).toBe(true);
    await pickProject(dialog, 'lib');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove app' }));
    expect(projectNames(dialog)).toEqual(['lib']);
    expect(within(dialog).getAllByText('Choose at least two projects').length).toBeGreaterThan(0);
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Remove lib' }).disabled,
    ).toBe(true);
    expect(within(dialog).getByRole('combobox', { name: 'Add project' })).toBeTruthy();
  });

  it('says which project waits for which when the tasks go in turn', async () => {
    multiMount();
    const dialog = await openMulti();
    await pickProject(dialog, 'lib');
    expect(within(dialog).queryByText('lib waits for app')).toBeNull();
    fireEvent.click(within(dialog).getByRole('switch', { name: 'In turn' }));
    expect(within(dialog).getByText('lib waits for app')).toBeTruthy();
  });

  it('shows the error with the project and keeps what was typed', async () => {
    const add = vi.fn(async () => {
      throw new Error('unknown pipeline `feature` in project `lib`');
    });
    multiMount({ add });
    const dialog = await openMulti();
    await pickProject(dialog, 'lib');
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'Email' } });
    await clickAdd(dialog);
    expect(
      await within(dialog).findByText('unknown pipeline `feature` in project `lib`'),
    ).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Task text').value).toBe('Email');
    expect(projectNames(dialog)).toEqual(['app', 'lib']);
  });
});

describe('the shared tag of a title', () => {
  it('cuts at the last whole word within 30 characters', () => {
    expect(defaultSharedTag('Email in profile')).toBe('Email in profile');
    expect(defaultSharedTag('  Add   the email field to the user profile page ')).toBe(
      'Add the email field to the',
    );
    expect(defaultSharedTag('Add the email field to the user')).toBe('Add the email field to the');
    expect(defaultSharedTag('x'.repeat(40))).toBe('x'.repeat(30));
    expect(defaultSharedTag('')).toBe('');
  });
});

describe('layout and keyboard of the task form', () => {
  async function mount() {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const dialog = await openDialog();
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Pipeline' }).textContent).toBe(
        'feature',
      ),
    );
    return { api, dialog };
  }
  const before = (first: HTMLElement, second: HTMLElement) =>
    Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('puts the Task / Groups switch above the text and the pipeline after it', async () => {
    const { dialog } = await mount();
    const task = within(dialog).getByRole('radio', { name: 'Task' });
    expect(within(dialog).getByRole('radio', { name: 'Groups' })).toBeTruthy();
    const text = within(dialog).getByLabelText('Task text');
    const pipeline = within(dialog).getByRole('combobox', { name: 'Pipeline' });
    expect(before(task, text)).toBe(true);
    expect(before(text, pipeline)).toBe(true);
  });

  it('keeps the action row of the dialog at the bottom of the scroll', async () => {
    const { dialog } = await mount();
    const row = within(dialog).getByRole('button', { name: 'Add' }).parentElement!;
    expect(row.className).toContain('sticky');
  });

  it('sends the task on Ctrl+Enter and on Meta+Enter', async () => {
    for (const key of ['ctrlKey', 'metaKey'] as const) {
      const { api, dialog } = await mount();
      const text = within(dialog).getByLabelText('Task text');
      fireEvent.change(text, { target: { value: 'Do it' } });
      fireEvent.keyDown(text, { key: 'Enter', [key]: true });
      await waitFor(() =>
        expect(api.queueAdd).toHaveBeenCalledWith({ pipeline: 'feature', task: 'Do it' }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      cleanup();
    }
  });

  it('does not send an empty form or a plain Enter', async () => {
    const { api, dialog } = await mount();
    const text = within(dialog).getByLabelText('Task text');
    fireEvent.keyDown(text, { key: 'Enter', ctrlKey: true });
    fireEvent.change(text, { target: { value: 'Do it' } });
    fireEvent.keyDown(text, { key: 'Enter' });
    expect(api.queueAdd).not.toHaveBeenCalled();
  });
});
