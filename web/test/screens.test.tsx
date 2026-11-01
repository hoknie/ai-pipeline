// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from 'sonner';

import { App } from '../src/App.tsx';
import { GroupScreen } from '../src/components/runs/GroupScreen.tsx';
import { RunHeader } from '../src/components/runs/RunHeader.tsx';

import { FakeEventSource, fakeApi, groupRow, groupView, openFake, runView } from './fixtures.ts';
import { act, cleanup, fireEvent, openTab, render, screen, waitFor, within } from './render.tsx';

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  toast.dismiss();
});

function mount(runs = [runView()], extra: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({ group: vi.fn(async () => groupView()), ...extra });
  render(<App api={api} openStream={openFake} />);
  act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs }));
  return api;
}

/** The shell and the test wrapper each mount a toaster, so one notice shows up once in each. */
async function expectOneNotice(text: string) {
  await waitFor(() => expect(screen.getAllByText(text)).toHaveLength(2));
}

const asking = () => groupRow({ status: 'needs_human', question: 'Какой провайдер?', diff: null });

describe('group screen', () => {
  it('shows the question of a group waiting for an answer and sends the answer with a notice', async () => {
    const api = mount([runView({ state: 'needs_human', waiting: 1, groups: [asking()] })], {
      group: vi.fn(async () => groupView({ status: 'needs_human' })),
    });
    expect(await screen.findByText('Какой провайдер?')).toBeTruthy();
    expect(screen.getAllByLabelText('Needs answer (needs_human)').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('answer for Вход'), { target: { value: 'OAuth' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('run1', 'login', 'OAuth'));
    await expectOneNotice('Answer sent');
    expect((screen.getByLabelText('answer for Вход') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps the chosen tab when the group moves to the next step', async () => {
    const first = { files: [{ path: 'old.ts', added: 1, removed: 0 }], added: 1, removed: 0 };
    const second = { files: [{ path: 'fresh.ts', added: 2, removed: 0 }], added: 2, removed: 0 };
    const group = vi
      .fn()
      .mockResolvedValueOnce(groupView({ diff: first }))
      .mockResolvedValue(groupView({ diff: second }));
    mount(
      [runView({ groups: [groupRow({ step: 'code', diff: { files: 1, added: 1, removed: 0 } })] })],
      { group },
    );
    await screen.findByRole('tab', { name: /^Changes/ });
    openTab(/^Changes/);
    expect(await screen.findByText('old.ts')).toBeTruthy();
    act(() =>
      FakeEventSource.last!.send({
        event: 'run',
        seq: 2,
        run: runView({
          groups: [
            groupRow({ step: 'review', round: 2, diff: { files: 1, added: 2, removed: 0 } }),
          ],
        }),
      }),
    );
    expect(await screen.findByText('fresh.ts')).toBeTruthy();
    expect(screen.queryByText('old.ts')).toBeNull();
    expect(screen.getByRole('tab', { name: /^Changes/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('opens the log on a link to a step', async () => {
    window.location.hash = '#runs/run1/login/code';
    mount();
    const tab = await screen.findByRole('tab', { name: 'Log' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(
      screen.getByRole('button', { name: /^attempt 1 code/ }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('cancels a group only after the confirmation', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel group' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Вход');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Do not cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel group' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Cancel group',
      }),
    );
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('run1', 'login'));
    expect((await screen.findAllByText('Group cancelled')).length).toBeGreaterThan(0);
  });

  it('disables the button of a running action until the request settles', async () => {
    let done: (value: unknown) => void = () => undefined;
    const retry = vi.fn(() => new Promise((resolve) => (done = resolve)));
    mount([runView({ state: 'active', groups: [groupRow({ status: 'failed' })] })], {
      retry,
    } as never);
    const button = await screen.findByRole('button', { name: 'Retry' });
    fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true));
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () => done({}));
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  });

  it('shows a skeleton until the data of the group arrive', async () => {
    let resolve: (view: ReturnType<typeof groupView>) => void = () => undefined;
    render(
      <GroupScreen
        api={fakeApi({
          group: vi.fn(() => new Promise<ReturnType<typeof groupView>>((done) => (resolve = done))),
        })}
        runId="run1"
        row={groupRow()}
        draftKey="run1/login"
        drafts={{}}
        onDraft={() => undefined}
        onClearDrafts={() => undefined}
        onError={() => undefined}
      />,
    );
    expect(screen.getByRole('status', { name: 'Loading the group' })).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    await act(async () => resolve(groupView()));
    expect(screen.queryByRole('status', { name: 'Loading the group' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Log' })).toBeTruthy();
  });

  it('shows the tree of a merged group with its totals', async () => {
    const files = [
      { path: 'src/cli/web/server.ts', added: 300, removed: 0 },
      { path: 'src/cli/web/index.ts', added: 66, removed: 0 },
    ];
    mount(
      [runView({ finished: true, state: 'finished', groups: [groupRow({ status: 'merged' })] })],
      {
        group: vi.fn(async () =>
          groupView({ status: 'merged', diff: { files, added: 366, removed: 0 } }),
        ),
      },
    );
    await screen.findByRole('tab', { name: /^Changes/ });
    openTab(/^Changes/);
    expect(await screen.findByRole('button', { name: /src\/cli\/web.*\+366/ })).toBeTruthy();
  });

  it('says that a group changed no files', async () => {
    mount();
    await screen.findByRole('tab', { name: 'Changes' });
    openTab('Changes');
    expect(await screen.findByText('No changes yet')).toBeTruthy();
  });
});

describe('run header', () => {
  it('cancels a run after the confirmation that names it', async () => {
    const api = fakeApi();
    render(<RunHeader run={runView()} api={api} now={0} onError={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('добавить вход');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Do not cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Cancel run',
      }),
    );
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('run1'));
  });

  it('disables «Deliver» while the delivery is requested', async () => {
    let done: (value: unknown) => void = () => undefined;
    const apply = vi.fn(() => new Promise((resolve) => (done = resolve)));
    const run = runView({
      delivery: { applied: 0, merged: 1, failed: 0, inProgress: false },
      groups: [groupRow({ status: 'merged' })],
    });
    render(
      <RunHeader run={run} api={fakeApi({ apply } as never)} now={0} onError={() => undefined} />,
    );
    const button = screen.getByRole('button', { name: 'Deliver' });
    fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true));
    await act(async () => done({}));
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  });

  it('names the run and the files in the force dialog', async () => {
    const api = fakeApi({
      group: vi.fn(async () =>
        groupView({
          status: 'merged',
          delivery: {
            state: 'apply_failed',
            reason: 'conflict',
            files: ['a.ts'],
            conflicts: [],
            userEdits: [],
          },
        }),
      ),
    });
    const run = runView({
      finished: true,
      delivery: { applied: 0, merged: 1, failed: 1, inProgress: false },
      groups: [groupRow({ status: 'merged', delivery: 'apply_failed' })],
    });
    render(<RunHeader run={run} api={api} now={0} onError={() => undefined} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Deliver with --force…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deliver with --force?' });
    expect(await within(dialog).findByText('a.ts')).toBeTruthy();
    expect(within(dialog).getByText('Вход')).toBeTruthy();
  });
});

describe('counter of the runs section', () => {
  it('counts runs waiting for an answer, not their groups', async () => {
    mount([
      runView({ id: 'a', state: 'needs_human', waiting: 3 }),
      runView({ id: 'b', state: 'active', waiting: 0 }),
    ]);
    const link = await screen.findByRole('link', { name: /^Runs/ });
    expect(link.textContent).toContain('1');
    expect(link.textContent).not.toContain('3');
  });
});

describe('empty states and narrow window', () => {
  it('shows the command and a link to the queue when there are no runs', async () => {
    mount([]);
    expect(await screen.findByText('No runs yet')).toBeTruthy();
    expect(screen.getByText(/aip run start feature --task/)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Open the queue' }));
    await waitFor(() => expect(window.location.hash).toBe('#queue'));
  });

  it('shows skeletons while the first snapshot is awaited', () => {
    render(<App api={fakeApi()} openStream={openFake} />);
    expect(screen.getByRole('status', { name: 'Connecting to the daemon' })).toBeTruthy();
  });

  it('opens the run screen when the run is chosen from the palette in a phone-wide window', async () => {
    const wide = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      mount([runView({ id: 'a', title: 'Первый' }), runView({ id: 'b', title: 'Второй' })]);
      expect(screen.queryByRole('button', { name: 'Back to the list' })).toBeNull();
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByText('Второй'));
      await waitFor(() => expect(window.location.hash).toBe('#runs/b'));
      expect(await screen.findByRole('button', { name: 'Back to the list' })).toBeTruthy();
    } finally {
      window.matchMedia = wide;
    }
  });

  it('shows the list, then the run with «Back to the list» in a phone-wide window', async () => {
    const wide = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      mount([runView({ id: 'a', title: 'Первый' }), runView({ id: 'b', title: 'Второй' })]);
      expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
      expect(screen.queryByRole('navigation', { name: 'sections' })).toBeNull();
      expect(screen.queryByRole('region', { name: /group/ })).toBeNull();
      fireEvent.click(screen.getByText('Второй'));
      expect(await screen.findByRole('region', { name: 'group Вход' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
      expect(screen.getByText('Первый')).toBeTruthy();
      expect(screen.queryByRole('region', { name: /group/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
      expect(await screen.findByRole('link', { name: /Queue/ })).toBeTruthy();
    } finally {
      window.matchMedia = wide;
    }
  });
});

describe('structured questions', () => {
  const questions = [
    { text: 'Какой **провайдер**?', options: ['OAuth', 'пароль'], recommendation: 'OAuth' },
    { text: 'Где хранить сессии?', recommendation: 'в базе' },
  ];
  const askingMany = (overrides: Parameters<typeof groupRow>[0] = {}) =>
    groupRow({
      status: 'needs_human',
      question: '1. Какой провайдер?',
      questions,
      diff: null,
      ...overrides,
    });
  const mountAsking = (extra: Parameters<typeof fakeApi>[0] = {}, row = askingMany()) =>
    mount([runView({ state: 'needs_human', waiting: 1, groups: [row] })], {
      group: vi.fn(async () => groupView({ status: 'needs_human' })),
      ...extra,
    });

  it('sends the recommended answers at once with a notice', async () => {
    const api = mountAsking();
    expect(await screen.findByText('Specialist questions · 2')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Question 1 of 2' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Question 2 of 2' })).toBeTruthy();
    expect(screen.getByText('Recommendation: в базе')).toBeTruthy();
    expect(screen.queryByText(/Unanswered/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await waitFor(() =>
      expect(api.answer).toHaveBeenCalledWith(
        'run1',
        'login',
        'Q1: Какой **провайдер**?\nA1: OAuth\n\nQ2: Где хранить сессии?\nA2: в базе',
      ),
    );
    await expectOneNotice('Answer sent');
  });

  it('puts a chosen option into the field and marks the recommended one', async () => {
    mountAsking();
    const oauth = await screen.findByRole('button', { name: /^OAuth/ });
    const password = screen.getByRole('button', { name: 'пароль' });
    expect(within(oauth).getByText('recommended')).toBeTruthy();
    expect(oauth.getAttribute('aria-pressed')).toBe('true');
    expect(password.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(password);
    expect((screen.getByLabelText('answer to question 1') as HTMLTextAreaElement).value).toBe(
      'пароль',
    );
    expect(password.getAttribute('aria-pressed')).toBe('true');
    expect(oauth.getAttribute('aria-pressed')).toBe('false');
    expect(within(oauth).getByText('recommended')).toBeTruthy();
  });

  it('disables the button and counts the unanswered questions', async () => {
    mountAsking();
    const field = await screen.findByLabelText('answer to question 2');
    fireEvent.change(field, { target: { value: '' } });
    expect(screen.getByText('Unanswered: 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Answer' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(field, { target: { value: 'в файле' } });
    expect(screen.queryByText(/Unanswered/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Answer' }).hasAttribute('disabled')).toBe(false);
  });

  it('keeps the draft over events, tabs and a move to another group', async () => {
    const other = groupRow({ slug: 'other', title: 'Другая', status: 'running' });
    const runs = (row: ReturnType<typeof groupRow>) => [
      runView({ state: 'needs_human', waiting: 1, groups: [row, other] }),
    ];
    mountAsking({}, askingMany());
    FakeEventSource.last!.send({ event: 'snapshot', seq: 2, runs: runs(askingMany()) });
    fireEvent.change(await screen.findByLabelText('answer to question 2'), {
      target: { value: 'в файле' },
    });
    act(() =>
      FakeEventSource.last!.send({
        event: 'run',
        seq: 3,
        run: runs(askingMany({ durationMs: 99_000 }))[0]!,
      }),
    );
    expect((screen.getByLabelText('answer to question 2') as HTMLTextAreaElement).value).toBe(
      'в файле',
    );
    openTab(/^Changes/);
    openTab('Log');
    expect((screen.getByLabelText('answer to question 2') as HTMLTextAreaElement).value).toBe(
      'в файле',
    );
    act(() => {
      window.location.hash = '#runs/run1/other';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(screen.queryByLabelText('answer to question 2')).toBeNull());
    act(() => {
      window.location.hash = '#runs/run1/login';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(
      ((await screen.findByLabelText('answer to question 2')) as HTMLTextAreaElement).value,
    ).toBe('в файле');
  });

  it('fills the fields of new questions with their recommendations after an answer', async () => {
    mountAsking();
    fireEvent.change(await screen.findByLabelText('answer to question 2'), {
      target: { value: 'в файле' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await expectOneNotice('Answer sent');
    act(() =>
      FakeEventSource.last!.send({
        event: 'run',
        seq: 5,
        run: runView({
          state: 'needs_human',
          waiting: 1,
          groups: [askingMany({ questions: [{ text: 'Нужен ли кеш?', recommendation: 'да' }] })],
        }),
      }),
    );
    expect(
      ((await screen.findByLabelText('answer to question 1')) as HTMLTextAreaElement).value,
    ).toBe('да');
  });

  it('shows the error and keeps the fields when the answer fails', async () => {
    const answer = vi.fn(async () => {
      throw new Error('демон недоступен');
    });
    mountAsking({ answer } as never);
    fireEvent.change(await screen.findByLabelText('answer to question 2'), {
      target: { value: 'в файле' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await expectOneNotice('демон недоступен');
    expect(screen.queryByText('Answer sent')).toBeNull();
    expect((screen.getByLabelText('answer to question 2') as HTMLTextAreaElement).value).toBe(
      'в файле',
    );
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it('shows a plain question with a list as a list', async () => {
    mount(
      [
        runView({
          state: 'needs_human',
          waiting: 1,
          groups: [asking()].map((row) => ({ ...row, question: '- вариант А\n- вариант Б' })),
        }),
      ],
      { group: vi.fn(async () => groupView({ status: 'needs_human' })) },
    );
    const form = (await screen.findByLabelText('answer for Вход')).closest('form')!;
    expect(within(form).getByRole('list')).toBeTruthy();
    expect(within(form).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('run state badges', () => {
  it('shows a failed run as failed in the list and in the header', async () => {
    mount([
      runView({
        state: 'failed',
        finished: true,
        groups: [groupRow({ status: 'failed' })],
        delivery: { applied: 0, merged: 0, failed: 1, inProgress: false },
      }),
    ]);
    const badges = await screen.findAllByLabelText('Failed (failed)');
    expect(badges.length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Finished (finished)')).toBeNull();
    expect((await screen.findAllByText('Delivery failed 1')).length).toBeGreaterThan(0);
  });

  it('shows the warnings of a finished run next to its state', async () => {
    mount([
      runView({
        state: 'finished',
        finished: true,
        groups: [groupRow({ status: 'merged', warnings: 1 })],
      }),
    ]);
    expect((await screen.findAllByLabelText('Finished (finished)')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Warnings: 1')).length).toBeGreaterThan(0);
  });

  it('has no warnings badge without warnings or while the run is active', async () => {
    mount([
      runView({ state: 'finished', finished: true, groups: [groupRow({ status: 'merged' })] }),
      runView({ id: 'r2', state: 'active', groups: [groupRow({ warnings: 2 })] }),
    ]);
    await screen.findAllByLabelText('Finished (finished)');
    expect(screen.queryByText(/^Warnings: /)).toBeNull();
  });
});
