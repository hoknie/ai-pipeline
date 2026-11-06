// @vitest-environment jsdom
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { GroupScreen } from '../src/components/runs/GroupScreen.tsx';
import { Attempt } from '../src/components/runs/Attempt.tsx';
import { RunDecisions } from '../src/components/runs/RunDecisions.tsx';
import { EMPTY_FILTERS } from '../src/components/runs/runFilter.ts';
import { TagsProvider } from '../src/tags.tsx';
import { RunHeader } from '../src/components/runs/RunHeader.tsx';
import { RunList } from '../src/components/runs/RunList.tsx';
import { navRunCounts } from '../src/components/runs/runFilter.ts';
import { notificationItems } from '../src/notifications.ts';
import {
  parseObserversView,
  repairOf,
  type RunRepair,
  type ObserverSettings,
} from '../src/observerTypes.ts';
import { statusInfo } from '../src/status.ts';
import type { RunView } from '../src/types.ts';

import {
  FakeEventSource,
  configView,
  fakeApi,
  groupRow,
  groupView,
  observersView,
  openFake,
  repositoryView,
  runView,
  systemRow,
} from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
});
afterEach(() => cleanup());

const repair = (overrides: Partial<RunRepair> = {}): RunRepair => ({
  allowed: true,
  active: false,
  repairs: 0,
  incident: null,
  ...overrides,
});

/** A run the daemon reports in the state `repair`; the state is not in the types before the merge. */
function repairing(overrides: Partial<RunView> = {}, extra: Partial<RunRepair> = {}) {
  return {
    ...runView({
      state: 'repair' as string as RunView['state'],
      groups: [groupRow({ slug: 'login', status: 'failed', reason: 'boom' })],
      ...overrides,
    }),
    repair: repair({ active: true, ...extra }),
  } as RunView;
}

describe('the observers as the panel reads them', () => {
  it('reads an answer and fills what is missing', () => {
    const view = parseObserversView({
      settings: { enabled: true, workers: 4, maxRepairs: 2 },
      workers: { running: [], waiting: 3 },
    });
    expect(view?.settings).toMatchObject({
      enabled: true,
      workers: 4,
      maxRepairs: 2,
      answerHumanOnly: false,
      projects: [],
      specialist: {},
    });
    expect(view?.workers.waiting).toBe(3);
  });

  it('reads the answers of GET and PUT through the same check', async () => {
    const answer = (status: number, body: unknown) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status }));
    const { httpApi: api } = await import('../src/api.ts');
    vi.stubGlobal('fetch', answer(200, { settings: {} }));
    await expect(api.observers()).rejects.toMatchObject({ status: 502 });
    await expect(api.setObservers(observersView().settings)).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal('fetch', answer(200, observersView()));
    expect((await api.observers()).settings.projects).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('refuses what is not a view', () => {
    expect(parseObserversView(null)).toBeNull();
    expect(parseObserversView('x')).toBeNull();
    expect(parseObserversView({ settings: {} })).toBeNull();
  });

  it('reads the repair of a run, and nothing for a run without it', () => {
    expect(repairOf(runView())).toBeNull();
    expect(repairOf(repairing())?.active).toBe(true);
  });

  it('keeps working when the stream sends an event it does not know', () => {
    const api = fakeApi({ runs: vi.fn(async () => []) });
    render(<App api={api} openStream={openFake} />);
    act(() =>
      FakeEventSource.last!.send({
        event: 'snapshot',
        seq: 1,
        runs: [runView({ title: 'Первая задача' })],
      }),
    );
    act(() => FakeEventSource.last!.send({ event: 'mystery', payload: { run: 1 } }));
    expect(screen.getAllByText('Первая задача').length).toBeGreaterThan(0);
  });
});

describe('settings of the observers', () => {
  const open = async (hash: string, overrides: Parameters<typeof fakeApi>[0] = {}) => {
    window.location.hash = hash;
    const api = fakeApi({ config: vi.fn(async () => configView()), ...overrides });
    render(<App api={api} openStream={openFake} />);
    act(() =>
      FakeEventSource.last!.send({
        event: 'snapshot',
        seq: 1,
        runs: [],
        repositories: [repositoryView('/work/app'), repositoryView('/work/lib')],
      }),
    );
    await screen.findByRole('tablist', { name: 'observer settings' });
    return api;
  };

  it('shows the main tab with the fields, the repairs and the waiting tasks', async () => {
    const view = observersView({ settings: { enabled: true, workers: 3 }, waiting: 2 });
    view.workers.running = [
      {
        runId: 'run7',
        repository: '/work/app',
        incident: { key: 'k', kind: 'failed', group: 'login', detail: 'boom' },
      },
    ];
    await open('#settings/global/observers', { observers: vi.fn(async () => view) });
    expect(
      (
        await screen.findByRole<HTMLInputElement>('switch', { name: 'Enable observers' })
      ).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByLabelText<HTMLInputElement>('Workers').value).toBe('3');
    expect(screen.getByLabelText('Repairs per task')).toBeTruthy();
    expect(screen.getByText('Answer questions meant only for a human')).toBeTruthy();
    expect(screen.getByText(/the agent decides it/)).toBeTruthy();
    const running = within(screen.getByTestId('observers-running'));
    expect(running.getByText(/run7/)).toBeTruthy();
    expect(screen.getByTestId('observers-waiting').textContent).toBe(
      '2 tasks are waiting for a worker',
    );
  });

  it('saves the form and shows the answer', async () => {
    const api = await open('#settings/global/observers');
    const workers = await screen.findByLabelText<HTMLInputElement>('Workers');
    fireEvent.change(workers, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Enable observers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setObservers).toHaveBeenCalled());
    const sent = vi.mocked(api.setObservers).mock.calls[0]![0] as ObserverSettings;
    expect(sent).toMatchObject({ enabled: true, workers: 5, projects: [] });
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Workers').value).toBe('5'));
  });

  it('shows the error of a specialist field at the field and keeps the values', async () => {
    const api = await open('#settings/global/observers', {
      setObservers: vi.fn(async () => ({
        ok: false as const,
        errors: [{ path: 'specialist.timeout', message: 'timeout must be like 30m' }],
      })),
    });
    fireEvent.change(await screen.findByLabelText<HTMLInputElement>('Workers'), {
      target: { value: '6' },
    });
    const tabs = screen.getByRole('tablist', { name: 'observer settings' });
    fireEvent.mouseDown(within(tabs).getByRole('tab', { name: 'Specialist' }));
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Specialist' }));
    const timeout = await screen.findByLabelText<HTMLInputElement>('Timeout');
    fireEvent.change(timeout, { target: { value: 'soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setObservers).toHaveBeenCalled());
    expect((await screen.findByText('timeout must be like 30m')).textContent).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Timeout').value).toBe('soon');
    // the other values stay too
    fireEvent.mouseDown(within(tabs).getByRole('tab', { name: 'Main' }));
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Main' }));
    expect((await screen.findByLabelText<HTMLInputElement>('Workers')).value).toBe('6');
  });

  it('has no slug, tags, limit or queue in the specialist tab', async () => {
    await open('#settings/global/observers/specialist');
    await screen.findByLabelText('Timeout');
    for (const name of ['New slug', 'Tags', 'Concurrency limit']) {
      expect(screen.queryByLabelText(name)).toBeNull();
    }
  });

  it('sends no max, tags or queue and keeps a key the form does not know', async () => {
    const view = observersView({
      settings: { specialist: { max: 3, tags: ['a'], queue: 'q', mcp: { x: 1 }, timeout: '5m' } },
    });
    const api = await open('#settings/global/observers', { observers: vi.fn(async () => view) });
    await screen.findByLabelText('Workers');
    fireEvent.change(screen.getByLabelText('Workers'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setObservers).toHaveBeenCalled());
    const sent = vi.mocked(api.setObservers).mock.calls[0]![0] as ObserverSettings;
    expect(sent.specialist).not.toHaveProperty('max');
    expect(sent.specialist).not.toHaveProperty('tags');
    expect(sent.specialist).not.toHaveProperty('queue');
    expect(sent.specialist.mcp).toEqual({ x: 1 });
  });

  it('puts the error of a project at the project it was sent for', async () => {
    const api = await open('#settings/global/observers/projects', {
      setObservers: vi.fn(async () => ({
        ok: false as const,
        errors: [{ path: 'projects[1].maxWorkers', message: 'too many' }],
      })),
    });
    await screen.findByLabelText('Workers in app');
    fireEvent.click(screen.getByRole('switch', { name: 'Connect app' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Connect lib' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setObservers).toHaveBeenCalled());
    await screen.findByText('too many');
    // switching a project afterwards does not move the error
    fireEvent.click(screen.getByRole('switch', { name: 'Connect app' }));
    const lib = screen.getByLabelText('Workers in lib');
    expect(lib.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Workers in app').getAttribute('aria-invalid')).not.toBe('true');
  });

  it('shows the error of a project missing from the registry in the common block', async () => {
    const view = observersView({
      settings: { projects: [{ repository: '/gone', maxWorkers: 1 }] },
    });
    await open('#settings/global/observers/projects', {
      observers: vi.fn(async () => view),
      setObservers: vi.fn(async () => ({
        ok: false as const,
        errors: [{ path: 'projects[0].maxWorkers', message: 'bad limit' }],
      })),
    });
    fireEvent.change(await screen.findByLabelText('Workers in app'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/bad limit/)).toBeTruthy();
  });

  it('does not ask about unsaved data after a project is switched on and off', async () => {
    await open('#settings/global/observers/projects');
    await screen.findByLabelText('Workers in app');
    fireEvent.click(screen.getByRole('switch', { name: 'Connect app' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Connect app' }));
    window.location.hash = '#settings/global/system';
    await waitFor(() =>
      expect(screen.queryByRole('tablist', { name: 'observer settings' })).toBeNull(),
    );
  });

  it('takes new settings from the stream into a clean form and keeps the edits of a dirty one', async () => {
    await open('#settings/global/observers');
    const workers = await screen.findByLabelText<HTMLInputElement>('Workers');
    const next = observersView({ settings: { workers: 7 }, waiting: 4 });
    act(() => FakeEventSource.last!.send({ event: 'observers', observers: next }));
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Workers').value).toBe('7'));
    fireEvent.change(workers, { target: { value: '9' } });
    const later = observersView({ settings: { workers: 11 }, waiting: 5 });
    later.workers.running = [
      {
        runId: 'run9',
        repository: '/work/app',
        incident: { key: 'k', kind: 'failed', group: 'g', detail: 'd' },
      },
    ];
    act(() => FakeEventSource.last!.send({ event: 'observers', observers: later }));
    await waitFor(() => expect(screen.getByTestId('observers-waiting').textContent).toContain('5'));
    expect(screen.getByLabelText<HTMLInputElement>('Workers').value).toBe('9');
    expect(within(screen.getByTestId('observers-running')).getByText(/run9/)).toBeTruthy();
  });

  it('connects a project with an empty limit by default', async () => {
    const api = await open('#settings/global/observers/projects');
    const limit = await screen.findByLabelText<HTMLInputElement>('Workers in app');
    expect(limit.value).toBe('');
    fireEvent.click(screen.getByRole('switch', { name: 'Connect app' }));
    fireEvent.change(screen.getByLabelText('Workers in app'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setObservers).toHaveBeenCalled());
    const sent = vi.mocked(api.setObservers).mock.calls[0]![0] as ObserverSettings;
    expect(sent.projects).toEqual([{ repository: '/work/app', maxWorkers: 2 }]);
  });
});

describe('the status Repair', () => {
  it('has a label in every language', async () => {
    const t = i18next.t.bind(i18next);
    expect(statusInfo('repair', t).label).toBe('Repair');
    await act(() => i18next.changeLanguage('ru'));
    expect(statusInfo('repair', i18next.t.bind(i18next)).label).toBe('Repair');
  });

  it('counts as work in the navigation', () => {
    expect(navRunCounts([repairing(), runView({ id: 'a' })])).toEqual({ working: 2, waiting: 0 });
  });

  it('hides the notifications of a task in repair', () => {
    const groups = [
      groupRow({ slug: 'a', status: 'needs_human', question: 'Which?' }),
      groupRow({ slug: 'b', status: 'failed', reason: 'boom' }),
      groupRow({ slug: 'c', status: 'conflict', reason: 'x' }),
      groupRow({ slug: 'd', status: 'merged', delivery: 'apply_failed', reason: 'y' }),
    ];
    expect(notificationItems([repairing({ groups })])).toEqual([]);
    expect(
      notificationItems([
        { ...repairing({ groups }), repair: repair({ active: false }) } as RunView,
      ]).length,
    ).toBe(4);
  });

  it('is shown by the header badge', () => {
    const run = repairing();
    render(<RunHeader run={run} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(screen.getAllByText('Repair').length).toBeGreaterThan(0);
  });
});

describe('the observer in the header of a task', () => {
  it('cancels the observer and shows Give back after the stream update', async () => {
    const api = fakeApi();
    const view = render(
      <RunHeader run={repairing()} api={api} now={0} onError={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the observer' }));
    await waitFor(() => expect(api.setRunObserver).toHaveBeenCalledWith('run1', '/repo', false));
    view.rerender(
      <RunHeader
        run={repairing({ state: 'active' }, { active: false, allowed: false })}
        api={api}
        now={0}
        onError={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Give back to the observer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel the observer' })).toBeNull();
    expect(screen.getByTestId('observer-forbidden')).toBeTruthy();
  });

  it('gives the task back to the observer', async () => {
    const api = fakeApi();
    const run = repairing({ state: 'active' }, { active: false, allowed: false });
    render(<RunHeader run={run} api={api} now={0} onError={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Give back to the observer' }));
    await waitFor(() => expect(api.setRunObserver).toHaveBeenCalledWith('run1', '/repo', true));
  });

  it('shows the error of the request next to the button', async () => {
    const api = fakeApi({
      setRunObserver: vi.fn(async () => {
        throw new Error('no observer here');
      }),
    });
    render(<RunHeader run={repairing()} api={api} now={0} onError={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the observer' }));
    expect((await screen.findByText('no observer here')).getAttribute('role')).toBe('alert');
    expect(screen.getByRole('button', { name: 'Cancel the observer' })).toBeTruthy();
  });

  it('shows the reason the observer gave when it cancelled the task', () => {
    const run = repairing(
      { state: 'cancelled', finished: true },
      { active: false, cancelReason: 'the plan is wrong' },
    );
    render(<RunHeader run={run} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(screen.getByTestId('observer-cancel-reason').textContent).toContain('the plan is wrong');
  });

  it('has no observer buttons for a task without repair data', () => {
    render(<RunHeader run={runView()} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Cancel the observer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Give back to the observer' })).toBeNull();
  });
});

describe('the journal and the author of the observer', () => {
  const show = (run: RunView) =>
    render(
      <TagsProvider tags={[]}>
        <RunList
          runs={[run]}
          selectedRun={run.id}
          selectedGroup={null}
          now={2_000}
          query=""
          onQuery={() => undefined}
          filters={EMPTY_FILTERS}
          onFilters={() => undefined}
          onSelect={() => undefined}
          scope="all"
          onScope={() => undefined}
          repository={null}
        />
      </TagsProvider>,
    );

  it('names the service group of the repair «Observer»', () => {
    const run = runView({
      system: [systemRow('repair' as string as 'split', { title: '_repair' })],
    });
    show(run);
    expect(screen.getAllByText('Observer').length).toBeGreaterThan(0);
  });

  it('marks the decisions of the observer', () => {
    const decisions = [
      {
        group: 'login',
        stepId: 'code',
        question: 'Which?',
        answer: 'This',
        by: 'observer' as string as 'human',
      },
    ];
    render(<RunDecisions run={runView({ decisions })} />);
    expect(screen.getByText(/Answers/).textContent).toBe('Answers: observer 1');
  });
});

describe('the screen of the service group of the observer', () => {
  const screenOf = (status: string) => {
    const attempts = [
      {
        ...groupView().attempts[0]!,
        seq: 1,
        stepId: 'repair',
        stepName: 'Починка',
        status: 'failed',
      },
    ];
    const api = fakeApi({ group: vi.fn(async () => groupView({ attempts })) });
    render(
      <GroupScreen
        api={api}
        runId="run1"
        row={systemRow('repair' as string as 'split', { status: status as 'failed' })}
        draftKey="run1/_repair"
        drafts={{}}
        onDraft={() => undefined}
        onClearDrafts={() => undefined}
        onError={() => undefined}
      />,
    );
  };

  for (const status of ['running', 'failed', 'cancelled']) {
    it(`is titled «Observer» with its attempts and no delivery or retry when ${status}`, async () => {
      screenOf(status);
      await screen.findByText(/#1 Починка/);
      expect(screen.getAllByText('Observer').length).toBeGreaterThan(0);
      expect(screen.queryByText('Retry delivery')).toBeNull();
      expect(screen.queryByText('Retry step')).toBeNull();
      expect(screen.queryByText(/^Retry/)).toBeNull();
    });
  }

  it('marks the answer of the observer in an attempt, not as a human', () => {
    const base = groupView().attempts[0]!;
    const attempt = {
      ...base,
      feedback: 'fix it',
      decision: { by: 'observer' as string as 'human', answer: 'Yes', question: 'Q' },
    };
    render(
      <Attempt
        api={fakeApi()}
        runId="run1"
        group="login"
        attempt={attempt as typeof base}
        initiallyOpen
        rawLog={null}
      />,
    );
    expect(screen.getByText('Answer (observer):')).toBeTruthy();
  });
});
