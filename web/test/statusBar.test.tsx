// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { StatusBar } from '../src/components/shell/StatusBar.tsx';

import {
  FakeEventSource,
  fakeApi,
  openFake,
  processView,
  repositoryView,
  runView,
  specialistUse,
} from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within, openTab } from './render.tsx';

beforeAll(() => {
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
});

afterEach(() => cleanup());

const APP = '/work/app';
const LIB = '/work/lib';

const runs = () => [
  runView({
    id: 'r1',
    title: 'Первый',
    repository: APP,
    specialists: [
      specialistUse('coder', { level: 'global', max: 1, running: ['login'] }),
      specialistUse('plan', { waiting: ['spec'] }),
    ],
  }),
  runView({
    id: 'r2',
    title: 'Второй',
    repository: LIB,
    specialists: [specialistUse('coder', { level: 'global', max: 1, waiting: ['api'] })],
  }),
];

const toggle = () => screen.getByRole('button', { name: 'Status' });
const summary = (running: number, waiting: number, processes: number | string) =>
  `Status: specialists — running ${running} · waiting ${waiting} | background processes — running ${processes}`;

function bar(
  api = fakeApi(),
  options: { runs?: ReturnType<typeof runs>; onOpenGroup?: () => void } = {},
) {
  render(
    <StatusBar
      runs={options.runs ?? runs()}
      selected={APP}
      connection="live"
      api={api}
      onOpenGroup={options.onOpenGroup ?? vi.fn()}
    />,
  );
  return api;
}

describe('status bar', () => {
  it('shows the summary with zeros and opens to the global and project blocks', async () => {
    bar();
    expect(await within(toggle()).findByText(summary(1, 2, 0))).toBeTruthy();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Global' })).toBeNull();
    fireEvent.click(toggle());
    const global = screen.getByRole('region', { name: 'Global' });
    expect(within(global).getByText('busy 1 of 1 · waiting 1')).toBeTruthy();
    expect(within(global).getByText('app')).toBeTruthy();
    expect(within(global).getByText('lib')).toBeTruthy();
    const project = screen.getByRole('region', { name: 'Project' });
    expect(within(project).getByText('plan')).toBeTruthy();
    expect(within(project).queryByText('coder')).toBeNull();
    const row = (name: string) => screen.getByRole('button', { name }).closest('li')!;
    expect(within(row('login')).getByText(/running/i)).toBeTruthy();
    expect(within(row('api')).queryByText(/running/i)).toBeNull();
  });

  it('counts zeros when everything is idle and says so in the tab', async () => {
    bar(fakeApi(), { runs: [runView()] });
    expect(await within(toggle()).findByText(summary(0, 0, 0))).toBeTruthy();
    fireEvent.click(toggle());
    expect(screen.getByText('No specialists are busy.')).toBeTruthy();
  });

  it('counts background processes', async () => {
    const api = fakeApi({
      processes: vi.fn(async () => ({
        processes: [processView(), processView({ pid: 4243 }), processView({ pid: 4244 })],
      })),
    });
    bar(api);
    expect(await within(toggle()).findByText(summary(1, 2, 3))).toBeTruthy();
  });

  it('shows a dash instead of the number before the first answer and on an error', async () => {
    const api = fakeApi({
      processes: vi.fn(async () => {
        throw new Error('daemon is old');
      }),
    });
    bar(api);
    expect(within(toggle()).getByText(summary(1, 2, '—'))).toBeTruthy();
    await waitFor(() => expect(api.processes).toHaveBeenCalled());
    expect(within(toggle()).getByText(summary(1, 2, '—'))).toBeTruthy();
    fireEvent.click(toggle());
    openTab('Background processes');
    expect(await screen.findByText('daemon is old')).toBeTruthy();
  });

  it('opens a group from the list', () => {
    const open = vi.fn();
    bar(fakeApi(), { onOpenGroup: open });
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'api' }));
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r2', group: 'api', step: 'code' }),
    );
  });

  it('remembers whether it is open and the tab', async () => {
    const api = fakeApi();
    bar(api);
    fireEvent.click(toggle());
    openTab('Background processes');
    cleanup();
    bar(api);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByRole('tab', { name: 'Background processes' }).getAttribute('data-state'),
    ).toBe('active');
    expect(await screen.findByText('No background processes.')).toBeTruthy();
  });

  it('shows the link with the daemon on the right, outside the toggle', () => {
    bar();
    const status = screen.getByRole('status', { name: 'link with the daemon: Connected' });
    expect(toggle().contains(status)).toBe(false);
    expect(within(status).getByText('Connected')).toBeTruthy();
    fireEvent.click(status);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('background processes tab', () => {
  async function open(
    api = fakeApi({ processes: vi.fn(async () => ({ processes: [processView()] })) }),
  ) {
    const onOpenGroup = vi.fn();
    bar(api, { onOpenGroup });
    fireEvent.click(toggle());
    openTab('Background processes');
    return { api, onOpenGroup };
  }

  it('lists a process with its time, CPU and memory', async () => {
    await open();
    const row = (await screen.findByText('4242')).closest('tr')!;
    expect(within(row).getByText('node').getAttribute('title')).toContain('vite');
    expect(within(row).getByText('2 min 5 s')).toBeTruthy();
    expect(within(row).getByText('12.0 %')).toBeTruthy();
    expect(within(row).getByText('120 MB')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'PID' })).toBeTruthy();
  });

  it('terminates a process after the confirmation and drops its row', async () => {
    const processes = vi
      .fn()
      .mockResolvedValueOnce({ processes: [processView()] })
      .mockResolvedValue({ processes: [] });
    const { api } = await open(fakeApi({ processes }));
    fireEvent.click(await screen.findByRole('button', { name: 'Terminate node (4242)' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('4242');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terminate' }));
    await waitFor(() => expect(api.killProcess).toHaveBeenCalledWith(4242));
    expect(await screen.findByText('No background processes.')).toBeTruthy();
  });

  it('does nothing when the confirmation is refused', async () => {
    const { api } = await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Terminate node (4242)' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^(Cancel|Do not)/ }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.killProcess).not.toHaveBeenCalled();
  });

  it('reports a failure to terminate', async () => {
    const api = fakeApi({
      processes: vi.fn(async () => ({ processes: [processView()] })),
      killProcess: vi.fn(async () => {
        throw new Error('not a background process: 4242');
      }),
    });
    await open(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Terminate node (4242)' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Terminate' }),
    );
    expect(await screen.findByText('not a background process: 4242')).toBeTruthy();
  });

  it('opens the group that owns the process', async () => {
    const { onOpenGroup } = await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Логин · Первый' }));
    expect(onOpenGroup).toHaveBeenCalledWith({ runId: 'run1', group: 'login', step: 'code' });
  });
});

describe('status bar in the panel', () => {
  function mount() {
    render(<App api={fakeApi()} openStream={openFake} />);
    act(() =>
      FakeEventSource.last?.send({
        event: 'snapshot',
        seq: 1,
        runs: runs(),
        repositories: [repositoryView(APP), repositoryView(LIB)],
      }),
    );
  }

  it('stays under the Topology and Queue tabs and follows the events', async () => {
    window.location.hash = '#topology/feature';
    mount();
    expect(await screen.findByText(summary(1, 2, 0))).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Queue' }));
    expect(await screen.findByText(summary(1, 2, 0))).toBeTruthy();
    act(() =>
      FakeEventSource.last?.send({
        event: 'run',
        run: runView({
          id: 'r2',
          title: 'Второй',
          repository: LIB,
          specialists: [specialistUse('coder', { level: 'global', max: 1, running: ['api'] })],
        }),
      }),
    );
    expect(await screen.findByText(summary(2, 1, 0))).toBeTruthy();
  });

  it('selects the repository of the run when a group is opened', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Status' }));
    fireEvent.click(screen.getByRole('button', { name: 'api' }));
    expect(window.location.hash).toBe('#runs/r2/api/code');
  });
});
