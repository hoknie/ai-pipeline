// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { clock } from '../src/shared/lib/format.ts';

import {
  FakeEventSource,
  fakeApi,
  groupRow,
  groupView,
  openFake,
  queueItem,
  queueOf,
  queueRun,
  runView,
} from './fixtures.ts';

const RESET = new Date(2026, 10, 2, 20, 50).getTime();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function showQueue(
  queue = queueOf(),
  overrides: Parameters<typeof fakeApi>[0] = {},
  hash = '#queue',
) {
  window.location.hash = hash;
  const api = fakeApi({ queue: vi.fn(async () => queue), ...overrides });
  render(<App api={api} openStream={openFake} />);
  return api;
}

function showRun(run = runView(), overrides: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({ group: vi.fn(async () => groupView()), ...overrides });
  render(<App api={api} openStream={openFake} />);
  act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs: [run] }));
  return api;
}

const settingsBlock = async () =>
  within(await screen.findByRole('region', { name: 'queue settings' }));
const controlsBlock = async () =>
  within(await screen.findByRole('region', { name: 'queue controls' }));

const limitStop = (autoResume: boolean) =>
  ({
    kind: 'limit',
    run: 'run1',
    group: 'login',
    runtime: 'claude',
    resetsAt: RESET,
    autoResume,
  }) as const;

describe('on a usage limit setting', () => {
  it('sends only onLimit when the user picks Stop', async () => {
    const api = showQueue(
      queueOf(),
      { queueSettings: vi.fn(async () => queueOf({ onLimit: 'stop' })) },
      '#settings/queue',
    );
    const block = await settingsBlock();
    const select = block.getByRole<HTMLButtonElement>('combobox', { name: 'On a usage limit' });
    expect(select.textContent).toBe('Wait for the reset');
    expect(block.getByText(/The queue always stops when an agent runs out/)).toBeTruthy();
    fireEvent.keyDown(select, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Stop' }));
    await waitFor(() => expect(api.queueSettings).toHaveBeenCalledWith({ onLimit: 'stop' }));
    await waitFor(() =>
      expect(block.getByRole('combobox', { name: 'On a usage limit' }).textContent).toBe('Stop'),
    );
  });
});

describe('a queue stopped by a usage limit', () => {
  it('shows the limit and the automatic start, and the pause cancels it', async () => {
    const api = showQueue(queueOf({ stop: limitStop(true) }), {
      queuePause: vi.fn(async () => queueOf({ stop: limitStop(false) })),
    });
    const alert = await screen.findByText(/the usage limit of claude ran out/);
    expect(alert.textContent).toContain(`resets at ${clock(RESET)}`);
    expect(alert.textContent).toContain(`Resumes by itself at ${clock(RESET)}`);
    expect(within(alert).getByRole('link', { name: 'Open group login' })).toBeTruthy();
    const block = await controlsBlock();
    const pause = block.getByRole<HTMLButtonElement>('button', { name: 'Pause' });
    expect(pause.disabled).toBe(false);
    fireEvent.click(pause);
    await waitFor(() => expect(api.queuePause).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/the usage limit of claude ran out/).textContent).not.toContain(
        'Resumes by itself',
      ),
    );
    expect(block.getByRole<HTMLButtonElement>('button', { name: 'Pause' }).disabled).toBe(true);
  });
});

describe('return to the queue', () => {
  it('returns a skipped run from its card', async () => {
    const api = showQueue(
      queueOf({ skipped: [queueRun('r1', { title: 'Логин', state: 'failed' })] }),
      {
        queueReturn: vi.fn(async () => ({
          ...queueOf({ items: [queueItem('q9', 'работа', 1, { run: 'r1', title: 'Логин' })] }),
          item: 'q9',
        })),
      },
    );
    const card = await screen.findByRole('group', { name: 'Логин' });
    fireEvent.click(within(card).getByRole('button', { name: 'Return to the queue' }));
    await waitFor(() => expect(api.queueReturn).toHaveBeenCalledWith('r1', '/repo'));
    const list = await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(within(list).getByRole('link', { name: 'Return' }).getAttribute('href')).toBe(
      '#runs/r1',
    );
  });

  it('keeps the task of a returned item locked in the edit form', async () => {
    const api = showQueue(
      queueOf({ items: [queueItem('q9', 'работа', 1, { run: 'r1', title: 'Логин' })] }),
    );
    const list = await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(within(list).getByRole('button', { name: 'Edit' }));
    const item = within(within(list).getAllByRole('listitem')[0]!);
    const text = await item.findByRole<HTMLTextAreaElement>('textbox', { name: 'Task text' });
    expect(text.matches(':disabled')).toBe(true);
    expect(item.getByRole('textbox', { name: 'Name' }).matches(':disabled')).toBe(true);
    fireEvent.click(item.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalledWith('q9', {}));
  });

  it('offers the return on the run screen only for a returnable run', async () => {
    window.location.hash = '#runs/run1';
    const api = showRun(
      runView({ state: 'failed', finished: true, returnable: true, repository: '/other' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Return to the queue' }));
    await waitFor(() => expect(api.queueReturn).toHaveBeenCalledWith('run1', '/other'));
    cleanup();
    window.location.hash = '#runs/run1';
    showRun(runView({ returnable: false }));
    await screen.findByRole('button', { name: 'Deliver' });
    expect(screen.queryByRole('button', { name: 'Return to the queue' })).toBeNull();
  });
});

describe('a returned run on the run screen', () => {
  it('shows Queued without the return button and goes back to Failed on the event', async () => {
    window.location.hash = '#runs/run1';
    showRun(
      runView({
        state: 'queued',
        finished: true,
        returnable: false,
        queueItem: 'q1',
        groups: [groupRow({ status: 'failed' })],
      }),
    );
    expect((await screen.findAllByText('Queued')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Return to the queue' })).toBeNull();
    act(() =>
      FakeEventSource.last!.send({
        event: 'run',
        seq: 2,
        run: runView({
          state: 'failed',
          finished: true,
          returnable: true,
          queueItem: null,
          groups: [groupRow({ status: 'failed' })],
        }),
      }),
    );
    await screen.findByRole('button', { name: 'Return to the queue' });
    expect(screen.queryByText('Queued')).toBeNull();
  });
});

describe('a group waiting for a usage limit', () => {
  it('shows until when it waits on the group screen', async () => {
    window.location.hash = '#runs/run1/login';
    showRun(runView({ groups: [groupRow({ status: 'queued', limitUntil: RESET })] }));
    expect(await screen.findByText(`Limit until ${clock(RESET)}`)).toBeTruthy();
  });

  it('translates the reason of a group failed on the limit', async () => {
    window.location.hash = '#runs/run1/login';
    showRun(
      runView({
        groups: [groupRow({ status: 'failed', reason: 'usage limit, resets 20:50' })],
      }),
    );
    expect(await screen.findByText('The usage limit ran out, resets at 20:50')).toBeTruthy();
  });
});

describe('a group that failed on the network', () => {
  it('translates the reason with the problem', async () => {
    window.location.hash = '#runs/run1/login';
    showRun(
      runView({
        groups: [groupRow({ status: 'failed', reason: 'network: API Error: Connection error.' })],
      }),
    );
    expect(await screen.findByText('No network: API Error: Connection error.')).toBeTruthy();
  });
});
