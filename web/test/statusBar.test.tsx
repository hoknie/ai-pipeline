// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { StatusBar } from '../src/components/shell/StatusBar.tsx';
import type { StreamedProcesses } from '../src/store.ts';

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
  options: {
    runs?: ReturnType<typeof runs>;
    onOpenGroup?: () => void;
    streamed?: StreamedProcesses | null;
  } = {},
) {
  render(
    <StatusBar
      runs={options.runs ?? runs()}
      selected={APP}
      connection="live"
      streamedProcesses={options.streamed ?? null}
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

  it('counts the processes of the stream without asking on a timer', async () => {
    const api = fakeApi({ processes: vi.fn(async () => ({ processes: [] })) });
    const view = (streamed: StreamedProcesses | null) => (
      <StatusBar
        runs={runs()}
        selected={APP}
        connection="live"
        streamedProcesses={streamed}
        api={api}
        onOpenGroup={vi.fn()}
      />
    );
    const { rerender } = render(view({ processes: [processView()], error: null }));
    expect(await within(toggle()).findByText(summary(1, 2, 1))).toBeTruthy();
    rerender(view({ processes: [processView(), processView({ pid: 4243 })], error: null }));
    expect(await within(toggle()).findByText(summary(1, 2, 2))).toBeTruthy();
    expect(api.processes).toHaveBeenCalledTimes(1);
  });

  it('shows a dash when the stream sends an error before any list', async () => {
    bar(fakeApi({ processes: vi.fn(() => new Promise<never>(() => undefined)) }), {
      streamed: { processes: null, error: 'no ps' },
    });
    expect(await within(toggle()).findByText(summary(1, 2, '—'))).toBeTruthy();
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
    const command = within(row).getByText('node /repo/node_modules/.bin/vite --port 5173');
    expect(command.tagName).toBe('CODE');
    expect(command.getAttribute('title')).toBeNull();
    expect(within(row).getByText('2 min 5 s')).toBeTruthy();
    expect(within(row).getByText('12.0 %')).toBeTruthy();
    expect(within(row).getByText('120 MB')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'PID' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Command' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Name' })).toBeNull();
  });

  it('shows the whole command in a tooltip on focus', async () => {
    await open();
    const row = (await screen.findByText('4242')).closest('tr')!;
    act(() =>
      within(row)
        .getByText(/vite --port/)
        .focus(),
    );
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'node /repo/node_modules/.bin/vite --port 5173',
    );
  });

  it('shows the name when the command is empty', async () => {
    await open(
      fakeApi({ processes: vi.fn(async () => ({ processes: [processView({ command: '' })] })) }),
    );
    const row = (await screen.findByText('4242')).closest('tr')!;
    expect(within(row).getByText('node').tagName).toBe('CODE');
  });

  it('copies the command', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy command' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('node /repo/node_modules/.bin/vite --port 5173'),
    );
    expect(await screen.findByText('Command copied')).toBeTruthy();
  });

  it('reports a clipboard that refuses', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied');
    });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy command' }));
    expect(await screen.findByText('The clipboard is not available')).toBeTruthy();
  });

  it('terminates with an icon button that has no text and a tooltip', async () => {
    await open();
    const button = await screen.findByRole('button', { name: 'Terminate node (4242)' });
    expect(button.textContent).toBe('');
    act(() => button.focus());
    expect((await screen.findByRole('tooltip')).textContent).toBe('Terminate');
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

describe('status bar height', () => {
  const content = () => screen.getByTestId('status-bar-content');
  const handle = () => screen.getByRole('separator', { name: 'Resize the Status strip' });
  const many = () =>
    fakeApi({
      processes: vi.fn(async () => ({
        processes: Array.from({ length: 20 }, (_, i) => processView({ pid: 5000 + i })),
      })),
    });

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  });

  it('keeps 256 px when switching tabs', async () => {
    bar(many());
    fireEvent.click(toggle());
    expect(content().style.height).toBe('256px');
    openTab('Background processes');
    await screen.findByText('5019');
    expect(content().style.height).toBe('256px');
    openTab('Specialists');
    expect(content().style.height).toBe('256px');
  });

  it('is changed by dragging the top edge and remembered', () => {
    bar();
    fireEvent.click(toggle());
    fireEvent.pointerDown(handle(), { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 400, pointerId: 1 });
    expect(content().style.height).toBe('356px');
    expect(window.localStorage.getItem('aip.web.statusBar.height')).toBe('356');
  });

  it('stays between 160 px and 80 % of the window', () => {
    bar();
    fireEvent.click(toggle());
    fireEvent.pointerDown(handle(), { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 0, pointerId: 1 });
    expect(content().style.height).toBe('720px');
    fireEvent.pointerDown(handle(), { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientY: 5000, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 5000, pointerId: 1 });
    expect(content().style.height).toBe('160px');
  });

  it('is changed by the arrow keys', () => {
    bar();
    fireEvent.click(toggle());
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(content().style.height).toBe('272px');
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(content().style.height).toBe('240px');
  });

  it('has aria-valuemax of 80 % of the window', () => {
    bar();
    fireEvent.click(toggle());
    expect(handle().getAttribute('aria-valuemax')).toBe('720');
  });

  it('cancels a drag when the strip is collapsed', () => {
    bar();
    fireEvent.click(toggle());
    fireEvent.pointerDown(handle(), { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientY: 400, pointerId: 1 });
    expect(content().style.height).toBe('356px');
    expect(document.body.classList.contains('select-none')).toBe(true);
    fireEvent.click(toggle());
    expect(document.body.classList.contains('select-none')).toBe(false);
    expect(window.localStorage.getItem('aip.web.statusBar.height')).toBeNull();
    fireEvent.click(toggle());
    expect(content().style.height).toBe('256px');
  });

  describe('in a shrunk window', () => {
    const resize = (height: number) =>
      act(() => {
        Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
        window.dispatchEvent(new Event('resize'));
      });
    const stored = () => window.localStorage.getItem('aip.web.statusBar.height');
    const openShrunk = () => {
      window.localStorage.setItem('aip.web.statusBar.height', '700');
      bar();
      fireEvent.click(toggle());
      resize(600);
      expect(content().style.height).toBe('480px');
    };

    it('keeps the chosen height after ArrowUp', () => {
      openShrunk();
      fireEvent.keyDown(handle(), { key: 'ArrowUp' });
      expect(content().style.height).toBe('480px');
      expect(stored()).toBe('700');
      resize(900);
      expect(content().style.height).toBe('700px');
    });

    it('keeps the chosen height after dragging up to the limit', () => {
      openShrunk();
      fireEvent.pointerDown(handle(), { clientY: 500, pointerId: 1 });
      fireEvent.pointerMove(handle(), { clientY: 0, pointerId: 1 });
      fireEvent.pointerUp(handle(), { clientY: 0, pointerId: 1 });
      expect(content().style.height).toBe('480px');
      expect(stored()).toBe('700');
    });

    it('remembers a real decrease', () => {
      openShrunk();
      fireEvent.keyDown(handle(), { key: 'ArrowDown' });
      expect(content().style.height).toBe('464px');
      expect(stored()).toBe('464');
    });
  });

  it('restores the remembered height and has no handle when collapsed', () => {
    window.localStorage.setItem('aip.web.statusBar.height', '400');
    bar();
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(toggle());
    expect(content().style.height).toBe('400px');
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
