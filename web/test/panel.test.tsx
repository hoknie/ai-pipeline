// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  openTab,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from './render.tsx';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { GroupScreen } from '../src/components/runs/GroupScreen.tsx';
import { Transcript } from '../src/components/Transcript.tsx';
import { RunHeader } from '../src/components/runs/RunHeader.tsx';
import { RunList } from '../src/components/runs/RunList.tsx';
import type { RunFilter } from '../src/components/runs/runFilter.ts';
import { files } from '../src/format.ts';
import { sortRuns, useRuns } from '../src/store.ts';

import {
  FakeEventSource,
  fakeApi,
  groupRow,
  groupView,
  openFake,
  repositoryView,
  runView,
} from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type ListProps = Partial<Omit<Parameters<typeof RunList>[0], 'runs'>>;

/** The list with its search and filter at rest. */
function list(runs: Parameters<typeof RunList>[0]['runs'], props: ListProps = {}) {
  const base = {
    selectedRun: null,
    selectedGroup: null,
    now: 0,
    query: '',
    onQuery: () => undefined,
    filter: 'all' as RunFilter,
    onFilter: () => undefined,
    onSelect: () => undefined,
    scope: 'repository' as const,
    onScope: () => undefined,
    repository: null,
    tagIds: [],
    onTagIds: () => undefined,
  };
  return <RunList runs={runs} {...base} {...props} />;
}

function stream(): FakeEventSource {
  const source = FakeEventSource.last;
  if (!source) throw new Error('no event source');
  return source;
}

function attempt(seq: number, overrides: Record<string, unknown> = {}) {
  return {
    ...groupView().attempts[0]!,
    seq,
    stepId: ['plan', 'code', 'review'][seq - 1] ?? 'qa',
    status: 'finished',
    verdict: 'done',
    ...overrides,
  };
}

describe('top bar and connection', () => {
  it('shows the aip web header and live, reconnecting and polling states', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = fakeApi();
    render(<App api={api} openStream={openFake} />);
    expect(screen.getByRole('link', { name: /aip\s*web/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Runs/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: 'Раны' })).toBeNull();
    expect(screen.getByRole('link', { name: /^Queue/ }).getAttribute('href')).toBe('#queue');
    for (const name of ['Topology', 'Specialists', 'Workflow'])
      expect(screen.getByRole('link', { name })).toBeTruthy();
    act(() => {
      stream().open();
      stream().send({ event: 'snapshot', seq: 1, runs: [runView()] });
    });
    expect(screen.getByRole('status', { name: 'link with the daemon: Connected' })).toBeTruthy();
    act(() => stream().fail());
    expect(screen.getByRole('status', { name: 'link with the daemon: Reconnecting' })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    expect(screen.getByRole('status', { name: 'link with the daemon: Polling' })).toBeTruthy();
    expect(api.runs).toHaveBeenCalled();
    act(() => stream().open());
    expect(screen.getByRole('status', { name: 'link with the daemon: Connected' })).toBeTruthy();
  });
});

describe('run state', () => {
  it('shows the cancelled badge in the list and in the header', () => {
    const cancelled = runView({ id: 'c', title: 'отменённый', finished: true, state: 'cancelled' });
    render(list([cancelled]));
    expect(screen.getByLabelText('Cancelled (cancelled)')).toBeTruthy();
    cleanup();
    render(<RunHeader run={cancelled} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(screen.getByLabelText('Cancelled (cancelled)')).toBeTruthy();
  });
});

describe('run times', () => {
  it('shows a running clock only for active runs', () => {
    const now = new Date(2026, 9, 31, 15, 0).getTime();
    const started = new Date(2026, 9, 31, 14, 30).getTime();
    render(
      list(
        [
          runView({ id: 'a', title: 'активный', createdAt: started }),
          runView({
            id: 'b',
            title: 'готовый',
            createdAt: started,
            finished: true,
            state: 'finished',
            finishedAt: started + 225_000,
          }),
        ],
        { now },
      ),
    );
    expect(screen.getByText('running 30m00s')).toBeTruthy();
    const time = new Date(started).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    expect(screen.getByText(`${time} · 3m45s`)).toBeTruthy();
  });
});

describe('needs_human runs', () => {
  const waiting = () =>
    runView({ id: 'w', title: 'ждущий', state: 'needs_human', waiting: 3, createdAt: 1 });

  it('sorts waiting runs first, then active, then finished, newest first', () => {
    const runs = [
      runView({ id: 'fin', finished: true, state: 'finished', createdAt: 9 }),
      runView({ id: 'new', createdAt: 8 }),
      runView({ id: 'old-wait', state: 'needs_human', waiting: 1, createdAt: 1 }),
      runView({ id: 'old', createdAt: 2 }),
    ];
    expect(sortRuns(runs).map((run) => run.id)).toEqual(['old-wait', 'new', 'old', 'fin']);
  });

  it('sorts by start time, not by creation time', () => {
    const runs = [
      runView({ id: 'created-late', createdAt: 50, startedAt: 100 }),
      runView({ id: 'created-early', createdAt: 10, startedAt: 200 }),
    ];
    expect(sortRuns(runs).map((run) => run.id)).toEqual(['created-early', 'created-late']);
  });

  it('puts an unfinished run that is not started above started ones', () => {
    const runs = [
      runView({ id: 'started', createdAt: 10, startedAt: 500 }),
      runView({ id: 'queued', createdAt: 5, startedAt: null }),
      runView({ id: 'queued-new', createdAt: 8, startedAt: null }),
    ];
    expect(sortRuns(runs).map((run) => run.id)).toEqual(['queued-new', 'queued', 'started']);
  });

  it('sorts finished runs by start time, falling back to creation time', () => {
    const runs = [
      runView({ id: 'a', finished: true, state: 'finished', createdAt: 5, startedAt: 100 }),
      runView({ id: 'b', finished: true, state: 'finished', createdAt: 300, startedAt: null }),
      runView({ id: 'c', finished: true, state: 'finished', createdAt: 1, startedAt: 200 }),
    ];
    expect(sortRuns(runs).map((run) => run.id)).toEqual(['b', 'c', 'a']);
  });

  it('shows needs_human ×N in the list and header, and active after the answer', () => {
    const { rerender } = render(list([waiting()], { now: 1000 }));
    expect(screen.getByText('Needs answer ×3')).toBeTruthy();
    rerender(list([{ ...waiting(), state: 'active', waiting: 0 }], { now: 1000 }));
    expect(screen.queryByText(/Needs answer/)).toBeNull();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows a plain needs_human badge for a single waiting group', () => {
    const run = { ...waiting(), waiting: 1 };
    render(<RunHeader run={run} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(screen.getByText('Needs answer')).toBeTruthy();
    expect(screen.getByLabelText('Needs answer (needs_human)')).toBeTruthy();
  });

  it('shows needs_human ×N in the run header', () => {
    render(<RunHeader run={waiting()} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(screen.getByText('Needs answer ×3')).toBeTruthy();
  });
});

describe('run tree', () => {
  it('marks a run created by the queue', () => {
    render(
      list(
        [
          runView({ id: 'a', title: 'из очереди тест', fromQueue: true }),
          runView({ id: 'b', title: 'вручную', fromQueue: false }),
        ],
        { now: 61_000 },
      ),
    );
    const marks = screen.getAllByText('from the queue');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.closest('li')?.textContent).toContain('из очереди тест');
  });

  it('labels runs by their tasks and lists the groups of the selected run', () => {
    render(
      list(
        [
          runView({
            id: 'a',
            title: 'добавить команду aip version',
            groups: [groupRow(), groupRow({ slug: 'signup', title: 'Регистрация' })],
          }),
          runView({
            id: 'b',
            title: 'сделай веб интерфейс',
            diff: { files: 2, added: 367, removed: 0 },
          }),
        ],
        { selectedRun: 'a', selectedGroup: 'login', now: 61_000 },
      ),
    );
    const runs = screen
      .getAllByRole('button', { expanded: true })
      .concat(screen.getAllByRole('button', { expanded: false }));
    expect(within(runs[0]!).getByText('добавить команду aip version')).toBeTruthy();
    expect(within(runs[0]!).getByText('feature')).toBeTruthy();
    expect(within(runs[1]!).getByText('2 files +367 −0')).toBeTruthy();
    const groups = screen.getAllByRole('list', { name: 'run groups' });
    expect(groups).toHaveLength(1);
    expect(within(groups[0]!).getByText('Вход')).toBeTruthy();
    expect(within(groups[0]!).getByText('Регистрация')).toBeTruthy();
  });

  function renderSelected(run: ReturnType<typeof runView>) {
    render(list([run], { selectedRun: run.id, now: 61_000 }));
  }

  it('shows no group list for a run with a single group', () => {
    renderSelected(runView());
    expect(screen.queryByRole('list', { name: 'run groups' })).toBeNull();
    expect(screen.queryByText('Вход')).toBeNull();
  });

  it('shows no group list while the task is still being split', () => {
    renderSelected(
      runView({ groups: [], split: { status: 'running', reason: null, question: null } as never }),
    );
    expect(screen.queryByRole('list', { name: 'run groups' })).toBeNull();
  });
});

describe('run page', () => {
  it('opens the only group on the right without a group list', async () => {
    const api = fakeApi({ group: vi.fn(async () => groupView()) });
    render(<App api={api} openStream={openFake} />);
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    expect(await screen.findByRole('region', { name: 'group Вход' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'run groups' })).toBeNull();
  });

  it('opens the only group by its address', async () => {
    window.location.hash = '#runs/run1/login';
    const api = fakeApi({ group: vi.fn(async () => groupView()) });
    render(<App api={api} openStream={openFake} />);
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    expect(await screen.findByRole('region', { name: 'group Вход' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'run groups' })).toBeNull();
  });

  it('opens the group that needs attention, switches groups and keeps a typed answer', async () => {
    const api = fakeApi({
      group: vi.fn(async (_run: string, slug: string) =>
        groupView({ slug, title: slug === 'signup' ? 'Регистрация' : 'Вход' }),
      ),
    });
    const asking = groupRow({
      slug: 'signup',
      title: 'Регистрация',
      status: 'needs_human',
      question: 'OAuth?',
    });
    const run = runView({
      groups: [groupRow({ status: 'merged', diff: { files: 2, added: 3, removed: 1 } }), asking],
    });
    render(<App api={api} openStream={openFake} />);
    act(() =>
      stream().send({ event: 'snapshot', seq: 1, runs: [run], repositories: [repositoryView()] }),
    );
    const tree = screen.getByRole('list', { name: 'run groups' });
    expect(within(tree).getAllByRole('button')[0]?.textContent).toContain('Регистрация');
    expect(screen.getByRole('region', { name: 'group Регистрация' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('answer for Регистрация'), {
      target: { value: 'пароль' },
    });
    act(() =>
      stream().send({
        event: 'run',
        seq: 2,
        run: { ...run, usage: { inputTokens: 5000, outputTokens: 1, costUsd: 1 } },
      }),
    );
    expect((screen.getByLabelText('answer for Регистрация') as HTMLTextAreaElement).value).toBe(
      'пароль',
    );
    fireEvent.click(within(tree).getByText('Вход'));
    const login = screen.getByRole('region', { name: 'group Вход' });
    expect(within(login).getByText('2 files +3 −1')).toBeTruthy();
    expect(within(login).getByLabelText('Merged (merged)').className).toContain('bg-status-ok-bg');
    expect(window.location.hash).toBe('#runs/run1/login');
    fireEvent.click(within(tree).getByText('Регистрация'));
    expect((screen.getByLabelText('answer for Регистрация') as HTMLTextAreaElement).value).toBe(
      'пароль',
    );
    fireEvent.click(screen.getByText('Answer'));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('run1', 'signup', 'пароль'));
  });

  it('delivers, and asks before delivering with --force', async () => {
    const api = fakeApi();
    const run = runView({
      finished: true,
      delivery: { applied: 0, merged: 1, failed: 1, inProgress: false },
      groups: [groupRow({ status: 'merged', delivery: 'apply_failed' })],
    });
    api.group = vi.fn(async () =>
      groupView({
        status: 'merged',
        delivery: {
          state: 'apply_failed',
          reason: 'the changes conflict with your working tree',
          files: ['src/app.ts'],
          conflicts: [],
          userEdits: [],
        },
      }),
    );
    render(<App api={api} openStream={openFake} />);
    act(() =>
      stream().send({ event: 'snapshot', seq: 1, runs: [run], repositories: [repositoryView()] }),
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Deliver with --force…' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('src/app.ts');
    expect(within(dialog).getByText('the changes conflict with your working tree')).toBeTruthy();
    fireEvent.click(within(dialog).getByText('Deliver with --force'));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('run1', true));
    fireEvent.click(screen.getByRole('button', { name: 'Deliver' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('run1', false));
  });
});

function panel(
  api: ReturnType<typeof fakeApi>,
  onlyReplies = false,
  onOnlyReplies?: (value: boolean) => void,
) {
  return render(
    <GroupScreen
      api={api}
      runId="run1"
      row={groupRow()}
      draftKey="run1/login"
      drafts={{}}
      onDraft={() => undefined}
      onClearDrafts={() => undefined}
      onError={() => undefined}
      onlyReplies={onlyReplies}
      {...(onOnlyReplies ? { onOnlyReplies } : {})}
    />,
  );
}

describe('attempts and transcript', () => {
  it('opens only the last of several attempts and the others on click', async () => {
    const api = fakeApi({
      group: vi.fn(async () =>
        groupView({
          attempts: [attempt(1), attempt(2), attempt(3, { status: 'running', verdict: null })],
        }),
      ),
    });
    panel(api);
    await screen.findByText('#3 review');
    const heads = () => screen.getAllByRole('button', { name: /^attempt \d+/ });
    expect(heads().map((head) => head.getAttribute('aria-expanded'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    await waitFor(() => expect(api.transcript).toHaveBeenCalledWith('run1', 'login', 3, 0));
    expect(api.transcript).toHaveBeenCalledTimes(1);
    fireEvent.click(heads()[0]!);
    await waitFor(() => expect(api.transcript).toHaveBeenCalledWith('run1', 'login', 1, 0));
  });

  it('shows refused commands with patterns and a hint for the group', async () => {
    const command = `cd /very/long/worktree/path/${'x'.repeat(200)} && claude plugin test integrations/claude-code`;
    const api = fakeApi({
      group: vi.fn(async () =>
        groupView({
          status: 'needs_human',
          question: 'запустите claude plugin test',
          permissionHints: ['claude plugin *'],
          attempts: [
            attempt(1, {
              status: 'finished',
              verdict: 'needs_human',
              denials: [
                {
                  tool: 'Bash',
                  command,
                  suggestions: [
                    {
                      part: 'claude plugin test integrations/claude-code',
                      pattern: 'claude plugin *',
                    },
                  ],
                },
                {
                  tool: 'Bash',
                  command: "cat > /tmp/x <<'EOF'",
                  suggestions: [{ part: "cat > /tmp/x <<'EOF'", pattern: null }],
                },
              ],
            }),
          ],
        }),
      ),
    });
    panel(api);
    expect(await screen.findByText('denials: 2')).toBeTruthy();
    const denials = screen.getByRole('region', { name: 'permission denials' });
    expect(within(denials).getByText(`Bash ${command}`).tagName).toBe('CODE');
    expect(within(denials).getByText('claude plugin *')).toBeTruthy();
    expect(within(denials).getByText('no pattern can allow this command')).toBeTruthy();
    const hint = screen.getByRole('region', { name: 'permissions hint' });
    expect(hint.textContent).toContain('Add to allow_commands: claude plugin *');
    expect(hint.textContent).toContain(
      'A retry or an answer to the question picks up the new permissions',
    );
  });

  it('shows a group from a daemon that does not send refused commands', async () => {
    const legacy = groupView() as Partial<ReturnType<typeof groupView>>;
    delete legacy.permissionHints;
    for (const item of legacy.attempts ?? []) delete (item as Partial<typeof item>).denials;
    panel(fakeApi({ group: vi.fn(async () => legacy as ReturnType<typeof groupView>) }));
    expect(await screen.findByText('#1 code')).toBeTruthy();
    expect(screen.queryByText(/denials:/)).toBeNull();
  });

  it('shows no refused commands for a group without them', async () => {
    panel(fakeApi());
    await screen.findByText('#1 code');
    expect(screen.queryByText(/denials:/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'permissions hint' })).toBeNull();
  });

  it('shows the specialist text as marked markdown, folds tool results under calls and errors in red', async () => {
    const api = fakeApi({
      group: vi.fn(async () =>
        groupView({
          attempts: [attempt(1, { summary: 'итог шага' })],
          diff: {
            files: [
              { path: 'README.md', added: 1, removed: 0 },
              { path: 'logo.png', added: null, removed: null },
            ],
            added: 1,
            removed: 0,
          },
        }),
      ),
      transcript: vi.fn(async () => ({
        runId: 'run1',
        group: 'login',
        seq: 1,
        cursor: 6,
        running: false,
        entries: [
          { kind: 'text' as const, text: '## План\n\n- пункт\n\n<script>alert(1)</script>' },
          {
            kind: 'tool_call' as const,
            id: 't1',
            name: 'Edit',
            summary: 'src/app.ts',
            input: '{}',
          },
          { kind: 'tool_result' as const, id: 't1', text: 'updated', error: false },
          { kind: 'tool_call' as const, id: 't2', name: 'Bash', summary: 'npm test', input: '{}' },
          {
            kind: 'tool_result' as const,
            id: 't2',
            text: 'permission denied: needs approval',
            error: true,
          },
          {
            kind: 'result' as const,
            text: null,
            error: false,
            verdict: 'done',
            inputTokens: 1500,
            outputTokens: 20,
            costUsd: 0.1,
          },
        ],
      })),
    });
    panel(api);
    const message = await screen.findByRole('region', { name: 'specialist text' });
    expect(within(message).getByText('Specialist')).toBeTruthy();
    expect(within(message).getByRole('heading', { name: 'План' })).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'attempt summary' }).textContent).toContain(
      'итог шага',
    );
    expect(screen.getByText('src/app.ts')).toBeTruthy();
    const ok = screen.getByRole('button', { name: /result · updated/ });
    expect(ok.getAttribute('aria-expanded')).toBe('false');
    const error = screen.getByRole('button', { name: /Error permission denied/ });
    expect(error.closest('div.border-status-err\\/30, [class*="bg-status-err-bg"]')).toBeTruthy();
    fireEvent.click(error);
    expect(error.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/1\.5k in/)).toBeTruthy();
    expect(screen.queryByText('{"type":"system"}')).toBeNull();
    fireEvent.click(screen.getByLabelText(/raw log/));
    expect(screen.getByText('{"type":"system"}')).toBeTruthy();
    openTab(/^Changes/);
    expect(screen.getByText('README.md')).toBeTruthy();
    expect(screen.getByText('binary')).toBeTruthy();
  });

  it('keeps reading the transcript of a running attempt from its cursor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transcript = vi
      .fn()
      .mockResolvedValueOnce({
        runId: 'run1',
        group: 'login',
        seq: 1,
        cursor: 2,
        running: true,
        entries: [{ kind: 'text', text: 'первый' }],
      })
      .mockResolvedValue({
        runId: 'run1',
        group: 'login',
        seq: 1,
        cursor: 5,
        running: false,
        entries: [{ kind: 'text', text: 'второй' }],
      });
    panel(fakeApi({ transcript }));
    expect(await screen.findByText('первый')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(await screen.findByText('второй')).toBeTruthy();
    expect(screen.getByText('первый')).toBeTruthy();
    expect(transcript).toHaveBeenLastCalledWith('run1', 'login', 1, 2);
  });

  function logApi(extra: Record<string, unknown> = {}) {
    return fakeApi({
      group: vi.fn(async () =>
        groupView({
          attempts: [attempt(1, { summary: 'итог шага', feedback: 'замечание', ...extra })],
        }),
      ),
      transcript: vi.fn(async () => ({
        runId: 'run1',
        group: 'login',
        seq: 1,
        cursor: 4,
        running: false,
        entries: [
          { kind: 'text' as const, text: 'ответ специалиста' },
          { kind: 'tool_call' as const, id: 't1', name: 'Read', summary: 'a.ts', input: '{}' },
          { kind: 'tool_result' as const, id: 't1', text: 'ok', error: false },
          {
            kind: 'tool_call' as const,
            id: 't2',
            name: 'mcp__aip__swarm_report',
            summary: 'done',
            input: '{}',
          },
        ],
      })),
    });
  }

  it('lists the files changed outside the worktree in a block and counts them in the head', async () => {
    const list = Array.from({ length: 10 }, (_, index) => `docs/file-${index}.md`);
    panel(logApi({ outsideChanges: list }));
    const head = await screen.findByRole('button', {
      name: 'Step plan (#1) changed 10 files outside its worktree',
    });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    const block = head.parentElement!;
    expect([...block.querySelectorAll('li code')].map((item) => item.textContent)).toEqual(list);
    expect(screen.getByText('outside worktree: 10')).toBeTruthy();
  });

  it('keeps a short list of outside changes open and shows nothing without them', async () => {
    panel(logApi({ outsideChanges: ['README.md'] }));
    const head = await screen.findByRole('button', { name: /changed 1 file outside its worktree/ });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    cleanup();
    panel(fakeApi());
    await screen.findByText('#1 code');
    expect(screen.queryByRole('button', { name: /outside its worktree/ })).toBeNull();
    expect(screen.queryByText(/outside worktree:/)).toBeNull();
  });

  it('keeps the attempt open when a nested block is folded', async () => {
    panel(logApi());
    await screen.findByText('ответ специалиста');
    const attemptHead = screen.getByRole('button', { name: /^attempt 1/ });
    const nested = screen.getByText('mcp__aip__swarm_report').closest('button')!;
    fireEvent.click(nested);
    expect(nested.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(nested);
    expect(nested.getAttribute('aria-expanded')).toBe('false');
    expect(attemptHead.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('ответ специалиста')).toBeTruthy();
  });

  it('puts the summary and the feedback under the log', async () => {
    panel(logApi());
    await screen.findByText('ответ специалиста');
    const heading = screen.getByRole('heading', { name: 'Log' });
    const summary = screen.getByRole('region', { name: 'attempt summary' });
    const feedback = screen.getByRole('region', { name: 'feedback' });
    const after = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(heading.compareDocumentPosition(summary) & after).toBeTruthy();
    expect(heading.compareDocumentPosition(feedback) & after).toBeTruthy();
    expect(screen.getByText('Read').compareDocumentPosition(summary) & after).toBeTruthy();
  });

  it('shows the whole log without a scroll area of its own', async () => {
    panel(logApi());
    await screen.findByText('ответ специалиста');
    expect(
      document.querySelector('[class*="overflow-y"]:has(ol[aria-label="attempts"])'),
    ).toBeNull();
    expect(screen.getByText('mcp__aip__swarm_report')).toBeTruthy();
  });

  it('shows only the specialist answers when the run asks for it, with no switch of its own', async () => {
    const { rerender } = panel(logApi(), true);
    await screen.findByText('ответ специалиста');
    expect(screen.queryByText('Read')).toBeNull();
    expect(screen.queryByLabelText('only specialist replies')).toBeNull();
    rerender(
      <GroupScreen
        api={logApi()}
        runId="run1"
        row={groupRow()}
        draftKey="run1/login"
        drafts={{}}
        onDraft={() => undefined}
        onClearDrafts={() => undefined}
        onError={() => undefined}
        onlyReplies={false}
      />,
    );
    expect(await screen.findByText('Read')).toBeTruthy();
  });

  it('has the switch of the filter in the head of the log', async () => {
    const onOnlyReplies = vi.fn();
    panel(logApi(), false, onOnlyReplies);
    await screen.findByText('ответ специалиста');
    fireEvent.click(screen.getByRole('switch', { name: 'only specialist replies' }));
    expect(onOnlyReplies).toHaveBeenCalledWith(true);
  });

  it('has the switch of JSON in the head of the log and none in the attempt', async () => {
    const onShowJson = vi.fn();
    render(
      <GroupScreen
        api={logApi()}
        runId="run1"
        row={groupRow()}
        draftKey="run1/login"
        drafts={{}}
        onDraft={() => undefined}
        onClearDrafts={() => undefined}
        onError={() => undefined}
        onShowJson={onShowJson}
      />,
    );
    await screen.findByText('ответ специалиста');
    expect(screen.getAllByRole('switch', { name: 'show JSON' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('switch', { name: 'show JSON' }));
    expect(onShowJson).toHaveBeenCalledWith(true);
  });

  it('says so when there are no specialist answers yet', async () => {
    const api = logApi();
    api.transcript = vi.fn(async () => ({
      runId: 'run1',
      group: 'login',
      seq: 1,
      cursor: 1,
      running: false,
      entries: [{ kind: 'tool_call' as const, id: 't1', name: 'Read', summary: 'a', input: '{}' }],
    }));
    panel(api, true);
    expect(await screen.findByText('No specialist replies yet.')).toBeTruthy();
  });
});

describe('plural of files', () => {
  it('declines the word by the count', async () => {
    const count = (list: number[]) => list.map((value) => files(value, i18next.t));
    expect(count([1, 3])).toEqual(['1 file', '3 files']);
    await i18next.changeLanguage('ru');
    expect(count([1, 2, 5, 11, 21, 22])).toEqual([
      '1 файл',
      '2 файла',
      '5 файлов',
      '11 файлов',
      '21 файл',
      '22 файла',
    ]);
  });
});

describe('run names', () => {
  it('shows the title and the name, and keeps the run id out of sight but in the link', () => {
    render(<App api={fakeApi()} openStream={openFake} />);
    act(() =>
      stream().send({
        event: 'snapshot',
        seq: 1,
        runs: [runView({ id: 'mvwed8krym92', title: 'добавить флаг', name: null })],
        repositories: [repositoryView()],
      }),
    );
    expect(screen.getAllByText('добавить флаг').length).toBeGreaterThan(0);
    act(() =>
      stream().send({
        event: 'run',
        seq: 2,
        run: runView({
          id: 'mvwed8krym92',
          title: 'Флаг --json для version',
          name: 'add-version-json-flag',
        }),
      }),
    );
    expect(screen.getAllByText('Флаг --json для version')).toHaveLength(2);
    expect(screen.getAllByText('add-version-json-flag')).toHaveLength(2);
    expect(screen.queryByText('mvwed8krym92')).toBeNull();
    expect(document.body.innerHTML).toContain('mvwed8krym92');
    expect(window.location.hash).toBe('#runs/mvwed8krym92');
  });
});

describe('daemon build', () => {
  const panel = { version: '0.1.0', fingerprint: 'new', builtAt: 2 };

  it('shows how to restart an older daemon and hides the warning once it matches', () => {
    render(<App api={fakeApi()} openStream={openFake} />);
    act(() =>
      stream().send({
        event: 'snapshot',
        seq: 1,
        runs: [],
        daemon: {
          outdated: 'daemon',
          pid: 1825,
          daemon: { version: '0.1.0', fingerprint: 'old', builtAt: 1 },
          client: panel,
          busy: true,
        },
      }),
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('older build than this panel');
    expect(alert.textContent).toContain('kill 1825');
    expect(alert.textContent).toContain('daemon: 0.1.0 old · panel: 0.1.0 new');
    act(() => stream().send({ event: 'daemon', daemon: null }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks to restart aip web when the daemon is newer', () => {
    render(<App api={fakeApi()} openStream={openFake} />);
    act(() =>
      stream().send({
        event: 'daemon',
        daemon: {
          outdated: 'client',
          pid: 1825,
          daemon: { version: '0.2.0', fingerprint: 'newer', builtAt: 3 },
          client: panel,
          busy: false,
        },
      }),
    );
    expect(screen.getByRole('alert').textContent).toContain('restart aip web');
    expect(screen.getByRole('alert').textContent).not.toContain('kill');
  });
});

describe('useRuns stability', () => {
  it('keeps the same array without events and on a repeated event, and old objects on a change', () => {
    const { result, rerender } = renderHook(() => useRuns(fakeApi(), openFake));
    const source = FakeEventSource.last!;
    const a = runView({ id: 'a' });
    const b = runView({ id: 'b' });
    act(() => source.send({ event: 'snapshot', seq: 1, runs: [a, b] }));
    const first = result.current.runs;
    rerender();
    expect(result.current.runs).toBe(first);
    act(() => source.send({ event: 'run', seq: 2, run: a }));
    expect(result.current.runs).toBe(first);
    act(() => source.send({ event: 'run', seq: 3, run: { ...a, title: 'Другое' } }));
    expect(result.current.runs).not.toBe(first);
    expect(result.current.runs.find((run) => run.id === 'b')).toBe(
      first.find((run) => run.id === 'b'),
    );
    const second = result.current.runs;
    act(() => source.send({ event: 'snapshot', seq: 4, runs: [{ ...a, title: 'Другое' }, b] }));
    expect(result.current.runs).toBe(second);
  });
});

describe('tag catalog and filter', () => {
  const auth = { id: 'ta', name: 'auth', color: 'red' as const };

  it('keeps the catalog from the snapshot and updates it on the tags event', () => {
    const api = fakeApi();
    const { result } = renderHook(() => useRuns(api, openFake));
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [], tags: [auth] }));
    expect(result.current.tags).toEqual([auth]);
    act(() => stream().send({ event: 'tags', seq: 2, tags: [{ ...auth, name: 'login' }] }));
    expect(result.current.tags.map((tag) => tag.name)).toEqual(['login']);
  });

  it('keeps the tag filter after a reload, under the new name', async () => {
    window.localStorage.setItem('aip.web.runTags', JSON.stringify(['ta', 'removed']));
    const tagged = runView({ id: 'a', title: 'С тегом', tags: [auth] });
    const plain = runView({ id: 'b', title: 'Без тега' });
    render(
      <App api={fakeApi({ runs: vi.fn(async () => [tagged, plain]) })} openStream={openFake} />,
    );
    act(() => {
      stream().open();
      stream().send({
        event: 'snapshot',
        seq: 1,
        runs: [tagged, plain],
        tags: [{ ...auth, name: 'login' }],
      });
    });
    const list = await screen.findByRole('list');
    expect(within(list).getByText('С тегом')).toBeTruthy();
    expect(within(list).queryByText('Без тега')).toBeNull();
    expect(within(list).getByText('login')).toBeTruthy();
    const field = screen.getByRole('combobox', { name: 'Tags' }).parentElement!;
    expect(within(field).getByText('login')).toBeTruthy();
  });

  it('shows nothing found with a reset that clears the tags', async () => {
    window.localStorage.setItem('aip.web.runTags', JSON.stringify(['ta']));
    const plain = runView({ id: 'b', title: 'Без тега' });
    render(<App api={fakeApi({ runs: vi.fn(async () => [plain]) })} openStream={openFake} />);
    act(() => {
      stream().open();
      stream().send({ event: 'snapshot', seq: 1, runs: [plain], tags: [auth] });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(document.querySelector('li[data-run="b"]')).toBeTruthy());
    expect(window.localStorage.getItem('aip.web.runTags')).toBe('[]');
  });
});

describe('JSON in the transcript', () => {
  const entries = [
    {
      kind: 'tool_call' as const,
      id: 'a',
      name: 'mcp__aip__swarm_queue',
      summary: '{"repo":"/w/app"}',
      input: '{\n  "repo": "/w/app"\n}',
    },
    {
      kind: 'tool_result' as const,
      id: 'a',
      error: false,
      text: '{"status":"running","parallel":2}',
    },
    {
      kind: 'tool_call' as const,
      id: 'b',
      name: 'TodoWrite',
      summary: '{"todos":[{"content":"Спека","status":"done"}]}',
      input: '{"todos":[{"content":"Спека","status":"done"}]}',
    },
    { kind: 'tool_call' as const, id: 'c', name: 'Edit', summary: 'src/app.ts', input: '{}' },
    { kind: 'tool_call' as const, id: 'd', name: 'Bash', summary: 'npm test', input: '{}' },
    { kind: 'tool_call' as const, id: 'e', name: 'Read', summary: 'a.ts', input: '{}' },
    { kind: 'tool_result' as const, id: 'e', error: false, text: 'export const a = 1;' },
    { kind: 'raw' as const, text: '{"type":"unknown_event"}' },
    { kind: 'raw' as const, text: 'Killed: 9' },
  ];

  function expandAll() {
    for (const button of screen.getAllByRole('button')) fireEvent.click(button);
  }

  it('renders JSON as key: value when it is off', () => {
    const { container } = render(<Transcript entries={entries} showJson={false} />);
    expandAll();
    expect(screen.getAllByText('repo: /w/app').length).toBeGreaterThan(0);
    expect(screen.getByText(/result · status: running/)).toBeTruthy();
    expect(container.textContent).toContain('status: running');
    expect(container.textContent).toContain('parallel: 2');
    expect(container.textContent).not.toContain('{"');
    expect(container.textContent).not.toContain('{\n');
    expect(container.textContent).toContain('- content: Спека');
    expect(container.textContent).toContain('status: done');
    expect(screen.getByText('src/app.ts')).toBeTruthy();
    expect(screen.getByText('npm test')).toBeTruthy();
    expect(screen.getByText('Killed: 9')).toBeTruthy();
    expect(screen.queryByText('{"type":"unknown_event"}')).toBeNull();
    expect(container.textContent).toContain('export const a = 1;');
  });

  it('shows the transcript as before when JSON is on', () => {
    const { container } = render(<Transcript entries={entries} />);
    expandAll();
    expect(screen.getAllByText('{"repo":"/w/app"}').length).toBeGreaterThan(0);
    expect(screen.getByText('{"type":"unknown_event"}')).toBeTruthy();
    expect(container.textContent).toContain('{"status":"running","parallel":2}');
  });

  it('keeps the raw log as it is', async () => {
    const api = fakeApi({
      group: vi.fn(async () => groupView({ log: { seq: 1, lines: ['{"type":"x"}'] } })),
    });
    panel(api);
    fireEvent.click(await screen.findByLabelText(/raw log/));
    expect(screen.getByText('{"type":"x"}')).toBeTruthy();
  });
});
