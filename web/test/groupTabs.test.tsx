// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGroupSpec } from '../src/features/runs/group/useGroupSpec.ts';

import { App } from '../src/app/App.tsx';
import { taskProgress } from '../src/features/runs/group/taskProgress.ts';
import { SPEC_POLL_MS } from '../src/features/runs/group/useGroupSpec.ts';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';
import type { GroupSpecView } from '../src/shared/api/types.ts';

import { FakeEventSource, fakeApi, groupRow, groupView, openFake, runView } from './fixtures.ts';
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

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const spec = (tasks: string | null, design: string | null = '# Design\n\ntext'): GroupSpecView => ({
  change: 'add-login',
  path: 'openspec/changes/add-login',
  design,
  tasks,
});

function mount(
  runs = [runView()],
  groupSpec: () => Promise<GroupSpecView | null> = async () => null,
) {
  const api = fakeApi({ group: vi.fn(async () => groupView()), groupSpec });
  render(<App api={api} openStream={openFake} />);
  act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs }));
  return api;
}

describe('route with a tab', () => {
  it('parses and formats the tab of a group', () => {
    expect(parseRoute('#runs/r1/api?tab=tasks')).toEqual({
      view: 'runs',
      run: 'r1',
      group: 'api',
      step: null,
      tab: 'tasks',
    });
    expect(parseRoute('#runs/r1/api/review?tab=changes')).toMatchObject({
      step: 'review',
      tab: 'changes',
    });
    expect(parseRoute('#runs/r1/api')).toMatchObject({ tab: null });
    expect(parseRoute('#settings/global/delivery')).toMatchObject({ view: 'settings', tab: null });
    const route = parseRoute('#runs/r1/api?tab=tasks');
    expect(formatRoute(route)).toBe('#runs/r1/api?tab=tasks');
    expect(formatRoute({ ...route, step: 'review', tab: 'changes' })).toBe(
      '#runs/r1/api/review?tab=changes',
    );
    expect(formatRoute({ ...route, tab: 'log' })).toBe('#runs/r1/api');
    expect(formatRoute({ ...route, group: null })).toBe('#runs/r1');
  });
});

describe('taskProgress', () => {
  it('counts checkboxes of any list marker', () => {
    expect(taskProgress('- [x] a\n* [X] b\n  + [ ] c\n- [ ] d\n')).toEqual({ done: 2, total: 4 });
  });

  it('is null without checkboxes', () => {
    expect(taskProgress('# Tasks\n\n- plain\n[ ] not a list')).toBeNull();
  });
});

describe('tabs of the group screen in the address', () => {
  it('writes the chosen tab to the address and opens a tab from it', async () => {
    window.location.hash = '#runs/run1/login';
    mount();
    await screen.findByRole('tab', { name: 'Changes' });
    openTab('Changes');
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/login?tab=changes'));
    openTab('Log');
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/login'));
    cleanup();
    window.location.hash = '#runs/run1/login?tab=changes';
    mount();
    const tab = await screen.findByRole('tab', { name: 'Changes' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });

  it('falls back to the log and drops the parameter when the tab does not exist', async () => {
    window.location.hash = '#runs/run1/login?tab=design';
    mount();
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/login'));
    expect((await screen.findByRole('tab', { name: 'Log' })).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'Design' })).toBeNull();
  });
});

describe('summary of the changes', () => {
  it('shows files and lines in the Changes tab and not in the header', async () => {
    window.location.hash = '#runs/run1/login?tab=changes';
    const api = fakeApi({
      group: vi.fn(async () =>
        groupView({
          diff: {
            added: 9,
            removed: 2,
            revision: 'r1',
            files: [
              { path: 'a.ts', added: 5, removed: 1 },
              { path: 'b.ts', added: 4, removed: 1 },
            ],
          },
        }),
      ),
    });
    render(<App api={api} openStream={openFake} />);
    act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    const panel = await screen.findByRole('tabpanel');
    await waitFor(() => expect(panel.textContent).toContain('2 files +9 −2'));
    const region = screen.getByRole('region', { name: 'group Вход' });
    expect(region.querySelector('header')!.textContent).not.toContain('2 files');
  });
});

describe('diff in the Changes tab while the step runs', () => {
  /** The group as the server shows it now: fresh objects at every call, like a real response. */
  const served = { revision: 'r1', added: 5 };
  const diff = () => ({
    added: served.added,
    removed: 1,
    revision: served.revision,
    files: [{ path: 'a.ts', added: served.added, removed: 1 }],
  });
  const lines = (word: string) => ['@@ -1,2 +1,2 @@', ' same', '-old', `+${word}`];

  async function openedDiff() {
    served.revision = 'r1';
    served.added = 5;
    window.location.hash = '#runs/run1/login?tab=changes';
    const api = fakeApi({
      group: vi.fn(async () => groupView({ diff: diff() })),
      fileDiff: vi.fn(async (_run: string, _group: string, path: string) => ({
        path,
        previousPath: null,
        binary: false,
        lines: lines(served.revision === 'r1' ? 'new' : 'newer'),
        totalLines: 4,
        truncated: false,
      })),
    });
    render(<App api={api} openStream={openFake} />);
    act(() =>
      FakeEventSource.last!.send({
        event: 'snapshot',
        seq: 1,
        runs: [runView({ groups: [groupRow({ diff: { files: 1, added: 5, removed: 1 } })] })],
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'a.ts' }));
    await screen.findByText('new');
    return api;
  }

  const send = (seq: number, added: number, overrides: Parameters<typeof groupRow>[0]) =>
    act(() =>
      FakeEventSource.last!.send({
        event: 'run',
        seq,
        run: runView({
          groups: [groupRow({ diff: { files: 1, added, removed: 1 }, ...overrides })],
        }),
      }),
    );

  it('reloads the group on growing tokens but neither asks for the diff again nor collapses it', async () => {
    const api = await openedDiff();
    const loads = vi.mocked(api.group).mock.calls.length;
    served.added = 6; // a visible sign that the new answer is applied
    send(2, 6, { usage: { inputTokens: 10, outputTokens: 2, costUsd: 0 } });
    await waitFor(() => expect(vi.mocked(api.group).mock.calls.length).toBeGreaterThan(loads));
    await waitFor(() => expect(screen.getByRole('tabpanel').textContent).toContain('+6 −1'));
    expect(screen.queryByText('Loading the diff…')).toBeNull();
    expect(screen.getByText('new')).toBeTruthy();
    expect(api.fileDiff).toHaveBeenCalledTimes(1);
  });

  it('shows the new content when the diff revision changes, without collapsing the old one', async () => {
    const api = await openedDiff();
    served.revision = 'r2';
    send(2, 5, { diffRevision: 'r2' });
    await screen.findByText('newer');
    expect(api.fileDiff).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Loading the diff…')).toBeNull();
    expect(screen.queryByText('new')).toBeNull();
  });
});

describe('moving to another group', () => {
  it('drops the tab from the address and selects the log', async () => {
    window.location.hash = '#runs/run1/login?tab=changes';
    const other = groupRow({ slug: 'other', title: 'Другая', status: 'running' });
    mount([runView({ groups: [groupRow(), other] })]);
    const tab = await screen.findByRole('tab', { name: 'Changes' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(await screen.findByRole('button', { name: /Другая/ }));
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/other'));
    expect((await screen.findByRole('tab', { name: 'Log' })).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('Artifacts tab', () => {
  const withArtifacts = (count: number) => runView({ groups: [groupRow({ artifacts: count })] });

  it('is visible but disabled without artifacts and cannot be selected', async () => {
    mount([withArtifacts(0)]);
    const tab = await screen.findByRole('tab', { name: 'Artifacts' });
    expect((tab as HTMLButtonElement).disabled).toBe(true);
    openTab('Artifacts');
    expect(tab.getAttribute('aria-selected')).toBe('false');
    expect(window.location.hash).not.toContain('artifacts');
  });

  it('with ?tab=artifacts but no artifacts opens the log and drops the parameter', async () => {
    window.location.hash = '#runs/run1/login?tab=artifacts';
    mount([withArtifacts(0)]);
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/login'));
    expect((await screen.findByRole('tab', { name: 'Log' })).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('lists the artifacts and keeps the tab in the address', async () => {
    const api = fakeApi({
      group: vi.fn(async () => groupView()),
      groupArtifacts: vi.fn(async () => [
        {
          id: 'a1',
          step: 'code',
          stepName: 'Кодировщик',
          seq: 1,
          specialist: 'coder',
          title: 'Отчёт',
          fileName: 'report.md',
          size: 10,
          createdAt: 1000,
          preview: 'markdown' as const,
        },
      ]),
    });
    window.location.hash = '#runs/run1/login?tab=artifacts';
    render(<App api={api} openStream={openFake} />);
    act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs: [withArtifacts(1)] }));
    const tab = await screen.findByRole('tab', { name: 'Artifacts · 1' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('report.md')).toBeTruthy();
    expect(window.location.hash).toBe('#runs/run1/login?tab=artifacts');
  });

  it('turns on when the counter grows', async () => {
    const api = fakeApi({ group: vi.fn(async () => groupView()) });
    render(<App api={api} openStream={openFake} />);
    window.location.hash = '#runs/run1/login';
    act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs: [withArtifacts(0)] }));
    const tab = await screen.findByRole('tab', { name: 'Artifacts' });
    expect((tab as HTMLButtonElement).disabled).toBe(true);
    act(() => FakeEventSource.last!.send({ event: 'run', seq: 2, run: withArtifacts(2) }));
    const next = await screen.findByRole('tab', { name: 'Artifacts · 2' });
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Design and Tasks tabs', () => {
  it('keeps the last documents and stays silent when a periodic request fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.location.hash = '#runs/run1/login?tab=tasks';
    const groupSpec = vi
      .fn()
      .mockResolvedValueOnce(spec('- [x] a\n- [ ] b\n'))
      .mockRejectedValue(new Error('spec-boom'));
    mount([runView()], groupSpec);
    await screen.findByRole('tab', { name: /^Tasks · 1\/2/ });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEC_POLL_MS * 2);
    });
    expect(groupSpec.mock.calls.length).toBeGreaterThan(1);
    expect(screen.queryByText(/spec-boom/)).toBeNull();
    expect(screen.getByRole('tab', { name: /^Tasks · 1\/2/ })).toBeTruthy();
  });

  it('reports a failed first request and resolves to no documents', async () => {
    const api = fakeApi({ groupSpec: vi.fn().mockRejectedValue(new Error('first')) });
    const onError = vi.fn();
    const { result } = renderHook(() => useGroupSpec(api, 'run1', 'login', 'v', false, onError));
    await waitFor(() => expect(result.current).toBeNull());
    expect(onError).toHaveBeenCalledWith('first');
  });

  it('drops ?tab=tasks from the address when the documents cannot be loaded', async () => {
    window.location.hash = '#runs/run1/login?tab=tasks';
    mount([runView()], vi.fn().mockRejectedValue(new Error('x')));
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/login'));
    expect((await screen.findByRole('tab', { name: 'Log' })).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('shows the tabs only for the files the change has, as Markdown, with progress', async () => {
    window.location.hash = '#runs/run1/login';
    mount(
      [runView()],
      vi.fn(async () => spec('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] one\n- [ ] two\n')),
    );
    await screen.findByRole('tab', { name: 'Design' });
    openTab(/^Tasks · 1\/2/);
    const block = await screen.findByRole('region', { name: 'Tasks' });
    expect(within(block).getByRole('table')).toBeTruthy();
    expect(within(block).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(block).getByText('Change: add-login')).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/login?tab=tasks'));
  });

  it('has no Design tab without design.md and no tabs without a change', async () => {
    window.location.hash = '#runs/run1/login';
    mount(
      [runView()],
      vi.fn(async () => spec('- [ ] one\n', null)),
    );
    await screen.findByRole('tab', { name: /^Tasks/ });
    expect(screen.queryByRole('tab', { name: 'Design' })).toBeNull();
    cleanup();
    mount();
    await screen.findByRole('tab', { name: 'Task' });
    expect(screen.queryByRole('tab', { name: /^Tasks/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Design' })).toBeNull();
  });

  it('polls while the group works and the tab is open, and stops for a merged group', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.location.hash = '#runs/run1/login?tab=tasks';
    const tasks = (done: number) => `${'- [x] a\n'.repeat(done)}${'- [ ] b\n'.repeat(10 - done)}`;
    const groupSpec = vi
      .fn()
      .mockResolvedValueOnce(spec(tasks(3)))
      .mockResolvedValue(spec(tasks(4)));
    mount([runView()], groupSpec);
    await screen.findByRole('tab', { name: /^Tasks · 3\/10/ });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEC_POLL_MS);
    });
    await screen.findByRole('tab', { name: /^Tasks · 4\/10/ });
    cleanup();

    const merged = vi.fn(async () => spec(tasks(10)));
    mount(
      [runView({ finished: true, state: 'finished', groups: [groupRow({ status: 'merged' })] })],
      merged,
    );
    await screen.findByRole('tab', { name: /^Tasks · 10\/10/ });
    const calls = merged.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEC_POLL_MS * 3);
    });
    expect(merged.mock.calls.length).toBe(calls);
  });

  it('does not poll on the log tab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.location.hash = '#runs/run1/login';
    const groupSpec = vi.fn(async () => spec('- [ ] a\n'));
    mount([runView()], groupSpec);
    await screen.findByRole('tab', { name: /^Tasks/ });
    const calls = groupSpec.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEC_POLL_MS * 3);
    });
    expect(groupSpec.mock.calls.length).toBe(calls);
  });
});
