// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from 'sonner';

import { App } from '../src/App.tsx';
import { GroupScreen } from '../src/components/runs/GroupScreen.tsx';
import { DiffStat } from '../src/components/runs/DiffStat.tsx';
import { RunHeader } from '../src/components/runs/RunHeader.tsx';

import { FakeEventSource, fakeApi, groupRow, groupView, openFake, runView } from './fixtures.ts';
import { setWindowWidth } from './media.ts';
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

  it('shows the task body as Markdown in a block on the Task tab', async () => {
    window.location.hash = '#runs/run1/login';
    mount();
    await screen.findByRole('tab', { name: 'Task' });
    openTab('Task');
    const block = await screen.findByRole('region', { name: 'Task' });
    expect(within(block).getByText('вход').tagName).toBe('STRONG');
  });

  it('opens the log on a link to a step', async () => {
    window.location.hash = '#runs/run1/login/code';
    mount();
    const tab = await screen.findByRole('tab', { name: 'Log' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(
      screen.getByRole('button', { name: /^attempt 1 Кодер/ }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('shows the step by its name in the head of the group and keeps the id in the hint', async () => {
    window.location.hash = '#runs/run1/login';
    mount([runView({ groups: [groupRow({ step: 'plan', stepName: 'Планировщик' })] })]);
    const name = await screen.findByText('Планировщик', { selector: 'span.font-medium' });
    expect(name.getAttribute('title')).toBe('plan');
  });

  it('cancels a group only after the confirmation', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Вход');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Do not cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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
    const button = await screen.findByRole('button', { name: 'More actions: Вход' });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry' }));
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
  it('has no «Cancel run» button on a running run', () => {
    render(
      <RunHeader
        run={runView({ state: 'active', finished: false })}
        api={fakeApi()}
        now={0}
        onError={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull();
  });

  it('shows the summary block: path, time, tokens, cost and type, in this order', () => {
    render(<RunHeader run={runView()} api={fakeApi()} now={0} onError={() => undefined} />);
    const summary = screen.getByRole('complementary', { name: 'Run summary' });
    expect(summary.className).toContain('border-l');
    expect(summary.className).toContain('@3xl:w-96');
    expect([...summary.querySelectorAll('dt')].map((node) => node.textContent)).toEqual([
      'Status',
      'Path',
      'Time',
      'Tokens',
      'Cost',
      'Type',
    ]);
    const values = [...summary.querySelectorAll('dd')].map((node) => node.textContent);
    expect(values[1]).toBe('/repo');
    expect(values[3]).toBe('1.0k/100');
    expect(values[4]).toBe('$0.42');
    expect(values[5]).toContain('feature');
  });

  it('has no tokens and cost rows without usage or price', () => {
    render(
      <RunHeader
        run={runView({ usage: null })}
        api={fakeApi()}
        now={0}
        onError={() => undefined}
      />,
    );
    const summary = screen.getByRole('complementary', { name: 'Run summary' });
    expect(within(summary).queryByText('Tokens')).toBeNull();
    expect(within(summary).queryByText('Cost')).toBeNull();
    cleanup();
    render(
      <RunHeader
        run={runView({ usage: { inputTokens: 1000, outputTokens: 100, costUsd: null } })}
        api={fakeApi()}
        now={0}
        onError={() => undefined}
      />,
    );
    const next = screen.getByRole('complementary', { name: 'Run summary' });
    expect(within(next).getByText('Tokens')).toBeTruthy();
    expect(within(next).queryByText('Cost')).toBeNull();
  });

  it('puts the state badge into the summary, not on the line of the title, and drops the sum of changes', () => {
    render(
      <RunHeader
        run={runView({ diff: { files: 3, added: 10, removed: 2 } })}
        api={fakeApi()}
        now={0}
        onError={() => undefined}
      />,
    );
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.parentElement!.querySelector('[aria-label*="("]')).toBeNull();
    const summary = screen.getByRole('complementary', { name: 'Run summary' });
    expect(summary.querySelector('dd [aria-label^="Active"]')).toBeTruthy();
    expect(title.className).not.toContain('truncate');
    expect(title.className).toContain('break-words');
    expect(screen.queryByText(/3 files/)).toBeNull();
    expect(screen.getAllByLabelText('Pipeline: feature')).toHaveLength(1);
  });

  it('reports a refused first delivery from the header as "Delivery failed", not "again"', async () => {
    const apply = vi.fn(async () => ({
      runId: 'run1',
      pending: false,
      groups: [
        {
          slug: 'login',
          delivery: {
            ...groupView().delivery,
            state: 'apply_failed' as const,
            reason: 'patch does not apply',
            finishedAt: 2000,
          },
        },
      ],
    }));
    mount(
      [
        runView({
          delivery: { applied: 0, merged: 1, failed: 0, inProgress: false, finishedAt: null },
          groups: [groupRow({ status: 'merged' })],
        }),
      ],
      { apply } as never,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Deliver' }));
    await expectOneNotice('Delivery failed: patch does not apply');
    expect(screen.queryByText(/Delivery started/)).toBeNull();
    expect(screen.queryByText(/failed again/)).toBeNull();
  });

  it('disables «Deliver» while the delivery is requested', async () => {
    let done: (value: unknown) => void = () => undefined;
    const apply = vi.fn(() => new Promise((resolve) => (done = resolve)));
    const run = runView({
      delivery: { applied: 0, merged: 1, failed: 0, inProgress: false, finishedAt: null },
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
            finishedAt: null,
          },
        }),
      ),
    });
    const run = runView({
      finished: true,
      delivery: { applied: 0, merged: 1, failed: 1, inProgress: false, finishedAt: null },
      groups: [groupRow({ status: 'merged', delivery: 'apply_failed' })],
    });
    render(<RunHeader run={run} api={api} now={0} onError={() => undefined} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Deliver with --force…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deliver with --force?' });
    const file = await within(dialog).findByText('a.ts');
    expect(file.tagName).toBe('CODE');
    expect(file.className).toContain('bg-muted');
    expect(file.className).toContain('break-all');
    expect(file.getAttribute('title')).toBe('a.ts');
    expect(within(dialog).getByText('Вход')).toBeTruthy();
  });
});

describe('delivery in progress on the group screen', () => {
  it('disables the retry actions and shows «Delivering» in the summary, not in the group header', async () => {
    window.location.hash = '#runs/run1/login';
    mount(
      [
        runView({
          finished: true,
          delivery: { applied: 0, merged: 1, failed: 1, inProgress: true, finishedAt: null },
          groups: [groupRow({ status: 'merged', delivery: 'apply_failed' })],
        }),
      ],
      {
        group: vi.fn(async () =>
          groupView({
            status: 'merged',
            delivery: {
              state: 'apply_failed',
              reason: 'conflict',
              files: ['a.ts'],
              conflicts: [],
              userEdits: [],
              finishedAt: null,
            },
          }),
        ),
      },
    );
    const retry = await screen.findByRole('button', { name: 'Retry delivery' });
    expect(retry.hasAttribute('disabled')).toBe(true);
    const summary = screen.getByRole('complementary', { name: 'Run summary' });
    expect(within(summary).getByText('Delivering')).toBeTruthy();
    expect(screen.getAllByText('Delivering')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
    const force = await screen.findByRole('menuitem', { name: 'Deliver with --force…' });
    expect(
      force.getAttribute('aria-disabled') ?? force.getAttribute('data-disabled'),
    ).not.toBeNull();
  });
});

describe('workflow badge in runs', () => {
  it('shows the badge in the run list instead of plain text', async () => {
    mount([runView({ id: 'a', title: 'Первый', workflow: 'feature' })]);
    const badge = await screen.findByLabelText('Pipeline: feature');
    expect(badge.closest('button')).toBeTruthy();
    expect(badge.hasAttribute('tabindex')).toBe(false);
    const row = badge.parentElement!;
    const plain = [...row.querySelectorAll('span')].filter(
      (node) => node.textContent === 'feature' && !badge.contains(node),
    );
    expect(plain).toHaveLength(0);
  });

  it('shows the badge once in the run header, inside the summary block', () => {
    render(<RunHeader run={runView()} api={fakeApi()} now={0} onError={() => undefined} />);
    const badge = screen.getByLabelText('Pipeline: feature');
    expect(badge.hasAttribute('tabindex')).toBe(true);
    expect(badge.closest('aside')).toBe(screen.getByRole('complementary', { name: 'Run summary' }));
  });
});

describe('counter of the runs section', () => {
  it('counts runs waiting for an answer, not their groups', async () => {
    mount([
      runView({ id: 'a', state: 'needs_human', waiting: 3 }),
      runView({ id: 'b', state: 'active', waiting: 0 }),
    ]);
    const badge = (await screen.findAllByLabelText('running: 2, waiting for an answer: 1'))[0]!;
    expect(badge.textContent).toBe('2');
    expect(screen.getByLabelText('waiting for an answer: 1').textContent).toBe('1');
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
        delivery: { applied: 0, merged: 0, failed: 1, inProgress: false, finishedAt: null },
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

  it('keeps the warnings out of the run header', async () => {
    mount([
      runView({
        state: 'finished',
        finished: true,
        groups: [groupRow({ status: 'merged', warnings: 1 })],
      }),
    ]);
    const header = await screen.findByRole('banner', { name: 'run' });
    expect(within(header).queryByText('Warnings: 1')).toBeNull();
    expect(screen.getAllByText('Warnings: 1').length).toBeGreaterThan(0);
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

describe('runs section columns', () => {
  let restore = () => {};
  afterEach(() => restore());

  const two = () => [
    runView({ id: 'a', title: 'Первый', state: 'needs_human', waiting: 1 }),
    runView({ id: 'b', title: 'Второй' }),
  ];

  it('stands the filters, the list and the run in three columns in a wide window', async () => {
    restore = setWindowWidth(1600);
    window.location.hash = '#runs/a';
    mount(two());
    const filters = await screen.findByRole('complementary', { name: 'Filters' });
    expect(filters.className).toContain('w-64');
    expect(within(filters).getByRole('searchbox', { name: 'Search runs' })).toBeTruthy();
    expect(within(filters).getByRole('radio', { name: 'Waiting 1' })).toBeTruthy();
    expect(within(filters).getByRole('radio', { name: 'This repository' })).toBeTruthy();
    expect(within(filters).queryByText('Первый')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
    expect(screen.getAllByText('Первый')[0]!.closest('aside')?.className).toContain('w-80');
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('keeps the filters behind a button in a medium window', async () => {
    restore = setWindowWidth(1100);
    mount(two());
    expect(screen.queryByRole('complementary', { name: 'Filters' })).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Search runs' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Filters' }));
    expect(await screen.findByRole('searchbox', { name: 'Search runs' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Waiting 1' })).toBeTruthy();
  });

  it('shows the number of filters in effect on the button', async () => {
    restore = setWindowWidth(1100);
    mount(two());
    fireEvent.click(await screen.findByRole('button', { name: 'Filters' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Waiting 1' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search runs' }), {
      target: { value: 'Первый' },
    });
    expect(await screen.findByRole('button', { name: 'Filters (2)' })).toBeTruthy();
  });

  it('opens the filters in a sheet in a phone-wide window', async () => {
    restore = setWindowWidth(360);
    mount(two());
    fireEvent.click(await screen.findByRole('button', { name: 'Filters' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('searchbox', { name: 'Search runs' })).toBeTruthy();
  });

  it('resets the filters of the column with «Reset»', async () => {
    restore = setWindowWidth(1600);
    mount(two());
    const filters = await screen.findByRole('complementary', { name: 'Filters' });
    fireEvent.change(within(filters).getByRole('searchbox', { name: 'Search runs' }), {
      target: { value: 'nothing-like-this' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));
    await waitFor(() =>
      expect(
        (within(filters).getByRole('searchbox', { name: 'Search runs' }) as HTMLInputElement).value,
      ).toBe(''),
    );
    expect(screen.getAllByText('Первый').length).toBeGreaterThan(0);
  });
});

describe('notification centre in the panel', () => {
  it('counts a live transition and opens the group of another repository', async () => {
    const quiet = runView({ id: 'a', repository: '/work/app' });
    const other = (status: 'running' | 'needs_human') =>
      runView({
        id: 'b',
        repository: '/work/lib',
        title: 'чужой запуск',
        groups: [
          groupRow({
            slug: 'ask',
            title: 'Вопрос чужого',
            status,
            question: status === 'needs_human' ? 'Какой тип?' : null,
          }),
        ],
      });
    const api = mount([quiet, other('running')], {
      group: vi.fn(async () => groupView({ runId: 'b', slug: 'ask', status: 'needs_human' })),
    });
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    act(() => FakeEventSource.last!.send({ event: 'run', seq: 2, run: other('needs_human') }));
    const bell = screen.getByRole('button', { name: 'Notifications, 1 unread' });
    expect(bell.textContent).toBe('1');
    fireEvent.click(bell);
    fireEvent.click(await screen.findByText('Вопрос чужого'));
    await waitFor(() => expect(window.location.hash).toContain('b'));
    await waitFor(() => expect(api.group).toHaveBeenCalledWith('b', 'ask'));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
  });
});

describe('diff stat', () => {
  it('shows the files in bold, added lines green and removed lines red', () => {
    render(<DiffStat diff={{ files: 2, added: 367, removed: 4 }} />);
    const strong = document.querySelector('strong')!;
    expect(strong.textContent).toBe('2 files');
    expect(strong.parentElement!.textContent).toBe('2 files +367 −4');
    expect(screen.getByText('+367').className).toContain('text-status-ok');
    expect(screen.getByText('−4').className).toContain('text-status-err');
  });
});

describe('usage in the group header', () => {
  const row = groupRow({
    durationMs: 65_000,
    usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.42 },
  });
  const show = (showUsage?: boolean) =>
    render(
      <GroupScreen
        api={fakeApi({ group: vi.fn(async () => groupView()) })}
        runId="run1"
        row={row}
        draftKey="run1/login"
        drafts={{}}
        onDraft={() => undefined}
        onClearDrafts={() => undefined}
        onError={() => undefined}
        run={runView()}
        {...(showUsage === undefined ? {} : { showUsage })}
      />,
    );

  it('hides duration, tokens and cost by default', () => {
    show();
    expect(screen.queryByText('1.0k/100')).toBeNull();
    expect(screen.queryByText('$0.42')).toBeNull();
    expect(screen.queryByText('1m05s')).toBeNull();
  });

  it('shows them when the run header is scrolled out of view', () => {
    show(true);
    expect(screen.getByText('1.0k/100')).toBeTruthy();
    expect(screen.getByText('$0.42')).toBeTruthy();
    expect(screen.getByText('1m05s')).toBeTruthy();
  });
});
