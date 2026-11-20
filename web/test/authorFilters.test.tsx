// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import QueuePage from '../src/features/queue/QueuePage.tsx';
import StatsPage from '../src/features/stats/StatsPage.tsx';
import { RunsPage } from '../src/features/runs/index.ts';
import type { AccessMe, QueueView, UserDirectoryEntry } from '../src/shared/api/types.ts';
import { authorIdOf, useAuthorChoices } from '../src/shared/lib/catalog/authors.ts';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';
import { rememberProjects } from '../src/shared/lib/catalog/repositories.ts';
import { AuthorFilter } from '../src/shared/ui/forms/filters/AuthorFilter.tsx';

import { useRuns } from '../src/shared/api/runs/useRuns.ts';

import {
  FakeSocket,
  fakeApi,
  openFake,
  queueItem,
  queueOf,
  queueRun,
  repositoryView,
  runView,
  statsReportView,
} from './fixtures.ts';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from './render.tsx';

afterEach(() => cleanup());

const alice = { id: 'u-alice', email: 'alice@corp.com', name: 'Alice', disabled: false };
const bob = { id: 'u-bob', email: 'bob@corp.com', name: 'Bob', disabled: false };
const users: UserDirectoryEntry[] = [alice, bob].map(({ id, email, name }) => ({
  id,
  email,
  name,
}));

/** The API of a signed in user (`bob`) of the server mode, or of the local mode. */
function serverApi(overrides = {}, local = false) {
  return fakeApi({
    accessMe: vi.fn(async (repository: string | null): Promise<AccessMe> => ({
      actor: local ? 'local' : 'user',
      userId: local ? null : bob.id,
      repository,
      actions: [],
      conditional: [],
      repositories: null,
    })),
    usersDirectory: vi.fn(async () => users),
    ...overrides,
  });
}

describe('the author in the address', () => {
  it('reads and writes `author` for the runs, the queue and the statistics only', () => {
    expect(parseRoute('#runs?author=me').author).toBe('me');
    expect(parseRoute('#queue?author=u1').author).toBe('u1');
    const stats = parseRoute('#stats?period=7d&project=%2Fwork%2Fapp&author=me');
    expect(stats).toMatchObject({ view: 'stats', run: '/work/app', author: 'me' });
    expect(formatRoute(stats)).toBe('#stats?period=7d&project=%2Fwork%2Fapp&author=me');
    expect(formatRoute({ ...parseRoute('#queue'), author: 'me' })).toBe('#queue?author=me');
    expect(formatRoute({ ...parseRoute('#runs'), author: 'u1' })).toBe('#runs?author=u1');
    expect(formatRoute({ ...parseRoute('#runs/r1/g1'), author: 'me' })).toBe(
      '#runs/r1/g1?author=me',
    );
    expect(formatRoute(parseRoute('#stats?period=30d'))).toBe('#stats?period=30d');
    expect(parseRoute('#specialists?author=me').author).toBeUndefined();
  });

  it('turns `me` into the id of the signed in user', () => {
    expect(authorIdOf('me', 'u1')).toBe('u1');
    expect(authorIdOf('u2', 'u1')).toBe('u2');
    expect(authorIdOf(null, 'u1')).toBeNull();
  });
});

describe('AuthorFilter', () => {
  it('offers everybody, «Mine» and the users, and reports the choice', () => {
    const onChange = vi.fn();
    render(<AuthorFilter toggle value={null} users={users} onChange={onChange} />);
    const select = screen.getByRole<HTMLSelectElement>('combobox');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All authors', 'Mine', 'Alice', 'Bob']);
    fireEvent.change(select, { target: { value: 'u-alice' } });
    expect(onChange).toHaveBeenLastCalledWith('u-alice');
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(onChange).toHaveBeenLastCalledWith('me');
  });

  it('switches «Mine» off again and shows it pressed', () => {
    const onChange = vi.fn();
    render(<AuthorFilter toggle value="me" users={users} onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Mine' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('the author in the statistics', () => {
  const registry = [repositoryView('/work/app', { color: 'blue' })];
  beforeEach(() => rememberProjects(registry));
  const row = (key: string, tokens: number, name: string | null, email?: string) => ({
    key,
    name,
    ...(email === undefined ? {} : { email }),
    attempts: 2,
    inputTokens: tokens,
    outputTokens: 0,
    tokens,
    agentMs: 1000,
    tokensPerAttempt: tokens / 2,
  });
  const report = statsReportView({
    totals: {
      tasks: 2,
      attempts: 4,
      inputTokens: 100_000,
      outputTokens: 0,
      tokens: 100_000,
      agentMs: 2000,
      commandMs: 0,
      wallMs: 2000,
    },
    byAuthor: [
      row('u-alice', 80_000, 'Alice', 'alice@corp.com'),
      row('u-bob', 20_000, 'Bob', 'bob@corp.com'),
      row('none', 1_000, null),
    ],
  });

  function mount(options: { local?: boolean; author?: string | null } = {}) {
    // the report of the local mode has no `byAuthor`
    const given = options.local === true ? { ...report, byAuthor: undefined } : report;
    const api = serverApi({ statsReport: vi.fn(async () => given) }, options.local);
    const onAuthor = vi.fn();
    const onFilter = vi.fn();
    render(
      <StatsPage
        api={api}
        registry={registry}
        runs={[]}
        period="30d"
        project={null}
        author={options.author ?? null}
        onFilter={onFilter}
        onAuthor={onAuthor}
      />,
    );
    return { api, onAuthor };
  }

  it('asks for the report of the author of the address', async () => {
    const { api } = mount({ author: 'me' });
    await waitFor(() =>
      expect(api.statsReport).toHaveBeenCalledWith(expect.objectContaining({ author: 'me' })),
    );
  });

  it('shows the filter «Author» and the table «By authors» with the unnamed row', async () => {
    const { onAuthor } = mount();
    const filter = await screen.findByRole('group', { name: 'Author' });
    fireEvent.change(within(filter).getByRole('combobox'), { target: { value: 'me' } });
    expect(onAuthor).toHaveBeenLastCalledWith('me');
    const table = await screen.findByTestId('authors-table');
    expect(within(table).getByRole('heading', { name: 'By authors' })).toBeTruthy();
    expect(within(table).getByText('No author')).toBeTruthy();
    fireEvent.click(within(table).getByRole('button', { name: 'Alice' }));
    expect(onAuthor).toHaveBeenLastCalledWith('u-alice');
  });

  it('shows neither in the local mode', async () => {
    const { api } = mount({ local: true });
    await waitFor(() => expect(api.accessMe).toHaveBeenCalled());
    expect(screen.queryByRole('group', { name: 'Author' })).toBeNull();
    // a report of the local mode has no `byAuthor`: no table
    expect(screen.queryByTestId('authors-table')).toBeNull();
  });
});

describe('the author in the queue', () => {
  const items = [
    queueItem('q1', 'a1', 1, { author: alice }),
    queueItem('q2', 'b1', 2, { author: bob }),
    queueItem('q3', 'a2', 3, { author: alice }),
    queueItem('q4', 'b2', 4, { author: bob }),
  ];

  function mount(author: string | null, extra: Partial<QueueView> = {}) {
    const queue = queueOf({ items, ...extra });
    const api = serverApi({ queueEdit: vi.fn(async () => queue) });
    const onAuthor = vi.fn();
    render(
      <QueuePage
        api={api}
        queue={queue}
        now={0}
        drafts={{}}
        onDraft={() => undefined}
        onQueue={() => undefined}
        onError={() => undefined}
        onNewTask={() => undefined}
        runs={[runView({ id: 'r-bob', author: bob }), runView({ id: 'r-alice', author: alice })]}
        author={author}
        onAuthor={onAuthor}
      />,
    );
    return { api, onAuthor };
  }

  const listed = () =>
    within(screen.getByRole('list', { name: 'tasks in the queue' }))
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('aria-label') ?? '');

  const holds = (labels: string[], task: string) => labels.some((label) => label.includes(task));

  it('hides the tasks of the others with «Mine»', async () => {
    mount('me');
    await waitFor(() => expect(listed()).toHaveLength(2));
    const labels = listed();
    expect(holds(labels, 'b1') && holds(labels, 'b2')).toBe(true);
    expect(holds(labels, 'a1') || holds(labels, 'a2')).toBe(false);
  });

  it('shows every task without a filter', async () => {
    mount(null);
    await waitFor(() => expect(listed()).toHaveLength(4));
    const labels = listed();
    for (const task of ['a1', 'b1', 'a2', 'b2']) expect(holds(labels, task)).toBe(true);
  });

  it('keeps the places of the hidden tasks when a visible one moves', async () => {
    // `me` is bob: his tasks are q2 and q4; moving q4 up takes the place of q2 in the whole queue
    const { api } = mount('me');
    await waitFor(() => expect(listed()).toHaveLength(2));
    const rows = within(screen.getByRole('list', { name: 'tasks in the queue' })).getAllByRole(
      'listitem',
    );
    fireEvent.keyDown(rows[1]!, { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalledWith('q4', { position: 2 }));
  });

  it('counts the places of all the tasks when the visible one moves down', async () => {
    const { api } = mount('me');
    await waitFor(() => expect(listed()).toHaveLength(2));
    const rows = within(screen.getByRole('list', { name: 'tasks in the queue' })).getAllByRole(
      'listitem',
    );
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalledWith('q2', { position: 4 }));
  });

  it('hides the runs and the skipped runs of the others', async () => {
    mount('u-alice', {
      runs: [queueRun('r-alice'), queueRun('r-bob')],
      skipped: [queueRun('r-alice', { number: 2 }), queueRun('r-bob', { number: 3 })],
    });
    await waitFor(() => expect(listed()).toHaveLength(2));
    for (const name of ['running from the queue', 'skipped with a problem']) {
      const block = await screen.findByRole('region', { name });
      expect(within(block).queryAllByText('r-alice').length).toBeGreaterThan(0);
      expect(within(block).queryAllByText('r-bob')).toHaveLength(0);
    }
  });

  it('offers the filter to choose an author', async () => {
    const { onAuthor } = mount(null);
    const filter = await screen.findByRole('group', { name: 'Author' });
    await waitFor(() => expect(within(filter).getAllByRole('option').length).toBeGreaterThan(2));
    fireEvent.click(within(filter).getByRole('button', { name: 'Mine' }));
    expect(onAuthor).toHaveBeenLastCalledWith('me');
    expect(listed()).toHaveLength(4);
  });
});

describe('the author in the list of runs', () => {
  it('shows the filter and lists only the runs of the author', async () => {
    const api = serverApi();
    const runs = [
      runView({ id: 'r-alice', title: 'Alice work', author: alice }),
      runView({ id: 'r-bob', title: 'Bob work', author: bob }),
    ];
    const onRoute = vi.fn();
    render(
      <RunsPage
        api={api}
        runs={runs}
        loaded
        route={{ view: 'runs', run: null, group: null, step: null, tab: null, author: 'me' }}
        now={0}
        drafts={{}}
        onDraft={() => undefined}
        onClearDrafts={() => undefined}
        onError={() => undefined}
        onlyReplies={false}
        onOnlyReplies={() => undefined}
        onRoute={onRoute}
        repository="/repo"
        scope="repository"
      />,
    );
    await screen.findByRole('group', { name: 'Author' });
    await waitFor(() => expect(screen.queryByText('Alice work')).toBeNull());
    expect(screen.getByText('Bob work')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(onRoute).toHaveBeenLastCalledWith(expect.objectContaining({ author: null }));
  });
});

describe('a stale `author` of the address in the local mode', () => {
  it('is not sent with the report', async () => {
    const statsReport = vi.fn(async () => statsReportView());
    const api = serverApi({ statsReport }, true);
    render(
      <StatsPage
        api={api}
        registry={[repositoryView('/work/app')]}
        runs={[]}
        period="30d"
        project={null}
        author="me"
        onFilter={() => undefined}
      />,
    );
    await waitFor(() => expect(api.accessMe).toHaveBeenCalled());
    await waitFor(() => expect(statsReport).toHaveBeenCalled());
    for (const call of statsReport.mock.calls as unknown[][]) {
      expect(call[0]).not.toHaveProperty('author');
    }
  });

  it('is not sent with the pages of finished runs', async () => {
    const finishedRuns = vi.fn().mockResolvedValue({ runs: [], next: null });
    const api = serverApi({ finishedRuns }, true);
    const { result } = renderHook(() => {
      const choices = useAuthorChoices(api);
      return useRuns(
        api,
        openFake,
        null,
        null,
        () => undefined,
        false,
        choices.enabled ? 'me' : null,
      );
    });
    act(() => FakeSocket.last!.send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(finishedRuns).toHaveBeenCalled());
    expect(finishedRuns).toHaveBeenLastCalledWith(undefined, undefined);
  });
});

describe('the finished runs of an author', () => {
  it('asks for the pages of the author and keeps a cursor for each author', async () => {
    const finishedRuns = vi.fn().mockResolvedValue({ runs: [], next: 'c1' });
    const api = fakeApi({ finishedRuns });
    const { result, rerender } = renderHook(
      ({ author }: { author: string | null }) =>
        useRuns(api, openFake, null, null, () => undefined, false, author),
      { initialProps: { author: 'me' as string | null } },
    );
    act(() => FakeSocket.last!.send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(finishedRuns).toHaveBeenCalledTimes(1));
    expect(finishedRuns).toHaveBeenLastCalledWith(undefined, undefined, 'me');
    await waitFor(() => expect(result.current.history.loading).toBe(false));
    rerender({ author: null });
    act(() => result.current.history.loadMore());
    await waitFor(() => expect(finishedRuns).toHaveBeenCalledTimes(2));
    expect(finishedRuns).toHaveBeenLastCalledWith(undefined, undefined);
  });
});
