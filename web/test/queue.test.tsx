// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { ApiError } from '../src/api.ts';
import { dropPosition, dropSlot, moveId } from '../src/components/queueOrder.ts';
import { afterOptions, dependents, depth, related, unmet } from '../src/components/queueLinks.ts';
import { parseParallel } from '../src/components/QueuePage.tsx';
import { formatRoute, parseRoute } from '../src/route.ts';
import { useRuns } from '../src/store.ts';

import { setWindowWidth } from './media.ts';
import {
  FakeEventSource,
  dependency,
  fakeApi,
  openFake,
  queueItem,
  queueOf,
  queueRun,
  runView,
  configView,
  settingsOf,
  workflowsView,
} from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '#queue';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const items = (...tasks: string[]) =>
  tasks.map((task, index) => queueItem(`q${index + 1}`, task, index + 1));

function show(queue = queueOf({ items: items('A', 'B', 'C') }), overrides = {}) {
  const api = fakeApi({ queue: vi.fn(async () => queue), ...overrides });
  render(<App api={api} openStream={openFake} />);
  return api;
}

function labels(): string[] {
  const list = screen.getByRole('list', { name: 'tasks in the queue' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('aria-label') ?? '');
}

function stream(): FakeEventSource {
  const source = FakeEventSource.last;
  if (!source) throw new Error('no event source');
  return source;
}

describe('routes and order helpers', () => {
  it('parses and formats #queue', () => {
    expect(parseRoute('#queue')).toEqual({ view: 'queue', run: null, group: null, step: null });
    expect(formatRoute(parseRoute('#queue'))).toBe('#queue');
  });

  it('finds the slot and the position of a drop', () => {
    expect(dropSlot([10, 30, 50], 0)).toBe(0);
    expect(dropSlot([10, 30, 50], 31)).toBe(2);
    expect(dropSlot([10, 30, 50], 99)).toBe(3);
    expect(dropPosition(2, 0)).toBe(1);
    expect(dropPosition(0, 3)).toBe(3);
    expect(dropPosition(1, 1)).toBeNull();
    expect(dropPosition(1, 2)).toBeNull();
    expect(moveId(['A', 'B', 'C'], 2, 1)).toEqual(['C', 'A', 'B']);
    expect(moveId(['A', 'B', 'C'], 0, 3)).toEqual(['B', 'C', 'A']);
  });

  it('accepts a parallel limit from 1 to 20', () => {
    expect(parseParallel('1')).toBe(1);
    expect(parseParallel('20')).toBe(20);
    for (const bad of ['0', '21', '', 'x', '1.5', '-1']) expect(parseParallel(bad)).toBeNull();
  });
});

describe('queue tab', () => {
  it('is selected after a reload and shows the queue', async () => {
    show();
    const tab = await screen.findByRole('link', { name: /Queue/ });
    expect(tab.getAttribute('aria-current')).toBe('page');
    await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(labels()).toEqual(['1. A', '2. B', '3. C']);
    expect(screen.getByText('Stopped')).toBeTruthy();
  });

  it('shows groups, titles and the start error of an item', async () => {
    show(
      queueOf({
        items: [
          queueItem('q1', '', 1, {
            task: null,
            groups: [
              { title: 'a', task: 'b' },
              { title: 'c', task: 'd' },
            ],
          }),
          queueItem('q2', 'длинный\nтекст', 2, { error: 'unknown workflow `feature`' }),
          queueItem('q3', 'x', 3, { title: 'Название' }),
        ],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(labels()).toEqual(['1. 2 groups', '2. длинный', '3. Название']);
    expect(screen.getByText(/unknown workflow/)).toBeTruthy();
  });

  it('shows the stop reason with a link to the group, and the running runs', async () => {
    show(
      queueOf({
        stop: { kind: 'problem', run: 'run1', group: 'login', reason: 'needs_human' },
        runs: [
          queueRun('run1', {
            title: 'Вход',
            problem: { group: 'login', reason: 'needs_human' },
          }),
        ],
      }),
    );
    const links = await screen.findAllByRole('link', { name: 'Open group login' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.getAttribute('href')).toBe('#runs/run1/login');
    expect(screen.getAllByText('needs_human', { selector: 'code' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Вход' }).getAttribute('href')).toBe('#runs/run1');
  });

  it('starts by the button and shows the running state from the answer', async () => {
    const queue = queueOf({ items: items('A', 'B') });
    const api = show(queue, {
      queueStart: vi.fn(async () =>
        queueOf({
          status: 'running',
          items: items('B'),
          runs: [queueRun('run7', { title: 'A' })],
        }),
      ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(api.queueStart).toHaveBeenCalledWith(undefined));
    await screen.findByText('Running');
    expect(labels()).toEqual(['1. B']);
    expect(screen.getByRole('link', { name: 'A' }).getAttribute('href')).toBe('#runs/run7');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pause' }).disabled).toBe(false);
  });

  it('keeps start unavailable for an empty queue and pause for a stopped one', async () => {
    show(queueOf());
    await screen.findByText('The queue is empty');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pause' }).disabled).toBe(true);
  });

  it('pauses a running queue', async () => {
    const api = show(queueOf({ status: 'running', items: items('A') }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.queuePause).toHaveBeenCalled());
  });

  it('saves the parallel limit without starting, and does not send a wrong one', async () => {
    const api = show(queueOf({ items: items('A') }));
    const field = await screen.findByLabelText('Parallelism');
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.blur(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(api.queueSettings).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true);
    fireEvent.change(field, { target: { value: '3' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(api.queueSettings).toHaveBeenCalledWith({ parallel: 3 }));
    expect(api.queueStart).not.toHaveBeenCalled();
  });

  it('starts with the typed parallel limit', async () => {
    const api = show(queueOf({ items: items('A') }));
    const field = await screen.findByLabelText('Parallelism');
    fireEvent.change(field, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(api.queueStart).toHaveBeenCalledWith(2));
  });
});

describe('live parallelism', () => {
  const stepper = () => screen.findByRole('button', { name: 'Increase parallelism' });

  it('raises the limit of a running queue at once without starting it', async () => {
    const api = show(queueOf({ status: 'running', items: items('A') }), {
      queueSettings: vi.fn(async ({ parallel }: { parallel?: number }) =>
        queueOf({ status: 'running', ...(parallel ? { parallel } : {}), items: items('A') }),
      ),
    });
    fireEvent.click(await stepper());
    expect(screen.getByLabelText<HTMLInputElement>('Parallelism').value).toBe('2');
    await waitFor(() => expect(api.queueSettings).toHaveBeenCalledWith({ parallel: 2 }));
    expect(api.queueStart).not.toHaveBeenCalled();
  });

  it('keeps one request in flight and sends the last value', async () => {
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    const queueSettings = vi.fn(async ({ parallel }: { parallel?: number }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return queueOf({ status: 'running', parallel });
    });
    show(queueOf({ status: 'running' }), { queueSettings });
    const plus = await stepper();
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(screen.getByLabelText<HTMLInputElement>('Parallelism').value).toBe('3');
    await waitFor(() => expect(queueSettings).toHaveBeenCalledTimes(1));
    act(() => releases.shift()!());
    await waitFor(() => expect(queueSettings).toHaveBeenCalledTimes(2));
    expect(queueSettings).toHaveBeenLastCalledWith({ parallel: 3 });
    act(() => releases.shift()!());
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Parallelism').value).toBe('3'),
    );
    expect(peak).toBe(1);
  });

  it('returns the old value and shows the error when saving fails', async () => {
    show(queueOf({ status: 'running', parallel: 2 }), {
      queueSettings: vi.fn(async () => {
        throw new ApiError(400, 'parallel must be an integer from 1 to 20');
      }),
    });
    fireEvent.click(await stepper());
    await screen.findByText(/parallel must be an integer/);
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Parallelism').value).toBe('2'),
    );
  });

  it('does not send 0 and disables the minus button at 1', async () => {
    const api = show(queueOf());
    const field = await screen.findByLabelText('Parallelism');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Decrease parallelism' }).disabled,
    ).toBe(true);
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(api.queueSettings).not.toHaveBeenCalled();
  });
});

describe('runs from the queue', () => {
  it('shows a card with progress, the active step and a free place', async () => {
    show(
      queueOf({
        status: 'running',
        parallel: 2,
        runs: [
          queueRun('run1', {
            title: 'Вход',
            groups: { done: 1, total: 3 },
            steps: { done: 2, total: 6, current: null },
            active: [{ group: 'signup', step: 'coder' }],
          }),
        ],
      }),
    );
    const card = await screen.findByRole('group', { name: 'Вход' });
    expect(within(card).getByText('feature')).toBeTruthy();
    expect(within(card).getByText('1 of 3 groups · steps 2 of 6')).toBeTruthy();
    expect(within(card).getByText('signup', { selector: 'code' })).toBeTruthy();
    expect(within(card).getByText(/coder/)).toBeTruthy();
    const bar = within(card).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('6');
    expect(screen.getByText(/1 of 2 places/)).toBeTruthy();
    expect(screen.getAllByText('Free place')).toHaveLength(1);
  });

  it('marks delivery and the task being split', async () => {
    show(
      queueOf({
        status: 'running',
        runs: [
          queueRun('run1', {
            title: 'A',
            delivering: true,
            groups: { done: 2, total: 2 },
            steps: { done: 8, total: 8, current: null },
          }),
        ],
        parallel: 3,
      }),
    );
    await screen.findByText('Delivery');
    cleanup();
    show(
      queueOf({
        status: 'running',
        runs: [
          queueRun('run2', {
            groups: { done: 0, total: 0 },
            steps: { done: 0, total: 0, current: null },
          }),
        ],
      }),
    );
    await screen.findByText('splitting the task');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('puts the title and the status on different rows', async () => {
    const title = 'Очень длинное название запуска '.repeat(5).trim();
    show(
      queueOf({
        status: 'running',
        runs: [queueRun('run1', { title })],
      }),
    );
    const card = await screen.findByRole('group', { name: title });
    const link = within(card).getByRole('link', { name: title });
    expect(link.getAttribute('title')).toBe(title);
    expect(link.className).toContain('truncate');
    const badge = within(card).getByText('Active');
    expect(link.parentElement).toBe(card);
    expect(badge.parentElement).not.toBe(link.parentElement);
    expect(badge.closest('div')!.contains(link)).toBe(false);
  });

  it('shows the step of a single group', async () => {
    show(
      queueOf({
        status: 'running',
        runs: [
          queueRun('run1', {
            title: 'Один',
            steps: { done: 1, total: 4, current: { step: 'coder', number: 2 } },
          }),
        ],
      }),
    );
    const card = await screen.findByRole('group', { name: 'Один' });
    expect(within(card).getByText('step 2 of 4 · coder')).toBeTruthy();
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
  });

  it('rolls the bar back when a group returns to an earlier step', async () => {
    show(
      queueOf({
        status: 'running',
        runs: [
          queueRun('run1', {
            title: 'Один',
            steps: { done: 1, total: 3, current: { step: 'review', number: 2 } },
          }),
        ],
      }),
    );
    const card = await screen.findByRole('group', { name: 'Один' });
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    act(() => {
      stream().open();
      stream().send({
        event: 'queue',
        seq: 5,
        queue: queueOf({
          status: 'running',
          runs: [
            queueRun('run1', {
              title: 'Один',
              steps: { done: 0, total: 3, current: { step: 'coder', number: 1 } },
            }),
          ],
        }),
      });
    });
    await screen.findByText('step 1 of 3 · coder');
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('says all steps are passed for a single finished group', async () => {
    show(
      queueOf({
        status: 'running',
        runs: [
          queueRun('run1', {
            title: 'Готово',
            steps: { done: 4, total: 4, current: null },
          }),
        ],
      }),
    );
    await screen.findByText('steps 4 of 4');
  });

  it('shows more runs than places with a note and without free places', async () => {
    show(
      queueOf({
        status: 'running',
        parallel: 1,
        runs: [queueRun('run1'), queueRun('run2')],
      }),
    );
    await screen.findByText(/2 of 1 place/);
    expect(screen.getByText(/runs already started keep going/)).toBeTruthy();
    expect(screen.queryByText('Free place')).toBeNull();
  });

  it('shows no free places in a stopped queue', async () => {
    show(queueOf({ parallel: 3, runs: [queueRun('run1')] }));
    await screen.findByRole('group', { name: 'run1' });
    expect(screen.queryByText('Free place')).toBeNull();
  });

  it('updates the card from a queue event', async () => {
    show(
      queueOf({
        status: 'running',
        runs: [queueRun('run1', { active: [{ group: 'g', step: 'code' }] })],
      }),
    );
    await screen.findByText(/code/);
    act(() => {
      stream().open();
      stream().send({
        event: 'queue',
        seq: 5,
        queue: queueOf({
          status: 'running',
          runs: [queueRun('run1', { active: [{ group: 'g', step: 'review' }] })],
        }),
      });
    });
    await screen.findByText(/review/);
  });
});

describe('workflow badge in the queue', () => {
  it('stands right after the state badge on the card, not in the time row', async () => {
    show(queueOf({ status: 'running', runs: [queueRun('run1', { title: 'Вход' })] }));
    const card = await screen.findByRole('group', { name: 'Вход' });
    const badge = within(card).getByLabelText('Workflow: feature');
    const state = within(card).getByText('Active').closest('span')!.parentElement!;
    expect(state.nextElementSibling).toBe(badge);
    expect(badge.parentElement).toBe(state.parentElement);
    const time = within(card).getByText(/^running /).parentElement!;
    expect(time.textContent).not.toContain('feature');
  });

  it('shows the badge in the row of a waiting task', async () => {
    show(queueOf({ items: [queueItem('q1', 'A', 1, { workflow: 'epic', readiness: 'waiting' })] }));
    const row = await screen.findByRole('listitem', { name: /A/ });
    expect(within(row).getByLabelText('Workflow: epic')).toBeTruthy();
  });
});

describe('new task form', () => {
  it('adds a task and clears the form without starting the queue', async () => {
    const api = show(queueOf(), {
      queueAdd: vi.fn(async () => ({ ...queueOf({ items: items('Сделать вход') }), item: 'q1' })),
    });
    const text = await screen.findByLabelText('Task text');
    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Workflow' }).textContent).toBe('feature'),
    );
    expect(add.disabled).toBe(true);
    fireEvent.change(text, { target: { value: 'Сделать вход' } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({ workflow: 'feature', task: 'Сделать вход' }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    expect((screen.getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('');
    expect(api.queueStart).not.toHaveBeenCalled();
  });

  it('adds a task made of two groups', async () => {
    const api = show(queueOf());
    await screen.findByLabelText('Task text');
    fireEvent.click(screen.getByRole('radio', { name: 'Groups' }));
    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    fireEvent.change(screen.getByLabelText('Title of group 1'), { target: { value: 'Вход' } });
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Text of group 1'), { target: { value: 'форма' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Title of group 2'), { target: { value: 'Выход' } });
    fireEvent.change(screen.getByLabelText('Text of group 2'), { target: { value: 'кнопка' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Пара' } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        workflow: 'feature',
        groups: [
          { title: 'Вход', task: 'форма' },
          { title: 'Выход', task: 'кнопка' },
        ],
        title: 'Пара',
      }),
    );
  });

  it('removes a group but keeps at least one', async () => {
    show(queueOf());
    await screen.findByLabelText('Task text');
    fireEvent.click(screen.getByRole('radio', { name: 'Groups' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove group 2' }));
    expect(screen.queryByLabelText('Title of group 2')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove group 1' }).disabled).toBe(
      true,
    );
  });

  it('shows the server error and keeps what was typed', async () => {
    const api = show(queueOf(), {
      queueAdd: vi.fn(async () => {
        throw new ApiError(400, 'unknown workflow `feature`; known: none');
      }),
    });
    const text = await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Workflow' }).textContent).toBe('feature'),
    );
    fireEvent.change(text, { target: { value: 'Сделать вход' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/unknown workflow/);
    expect(api.queueAdd).toHaveBeenCalled();
    expect((screen.getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('Сделать вход');
  });

  it('keeps the typed text when a queue or run event arrives and when the tab changes', async () => {
    show(queueOf({ items: items('A') }));
    const text = await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Workflow' }).textContent).toBe('feature'),
    );
    fireEvent.change(text, { target: { value: 'черновик' } });
    act(() => {
      stream().open();
      stream().send({ event: 'queue', seq: 5, queue: queueOf({ items: items('A', 'Z') }) });
      stream().send({ event: 'run', seq: 6, run: runView() });
    });
    await waitFor(() => expect(labels()).toEqual(['1. A', '2. Z']));
    expect((screen.getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('черновик');
    fireEvent.click(screen.getByRole('link', { name: /Runs/ }));
    fireEvent.click(await screen.findByRole('link', { name: /Queue/ }));
    expect(((await screen.findByLabelText('Task text')) as HTMLTextAreaElement).value).toBe(
      'черновик',
    );
  });

  it('keeps the typed text when the language changes and shows the labels in the new one', async () => {
    show(queueOf({ items: items('A') }));
    const text = await screen.findByLabelText('Task text');
    fireEvent.change(text, { target: { value: 'черновик' } });
    act(() => {
      void i18next.changeLanguage('ru');
    });
    const field = await screen.findByLabelText<HTMLTextAreaElement>('Текст задачи');
    expect(field.value).toBe('черновик');
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeTruthy();
    expect(screen.queryByLabelText('Task text')).toBeNull();
  });
});

describe('automatic delivery switch', () => {
  it('sends autoDeliver false after switching off, and shows the task as manual', async () => {
    const api = show(queueOf(), {
      queueAdd: vi.fn(async () => ({
        ...queueOf({ items: [queueItem('q1', 'Сделать вход', 1, { autoDeliver: false })] }),
        item: 'q1',
      })),
    });
    const text = await screen.findByLabelText('Task text');
    const toggle = screen.getByRole('switch', { name: 'Auto delivery' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('as in the settings')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Workflow' }).textContent).toBe('feature'),
    );
    fireEvent.change(text, { target: { value: 'Сделать вход' } });
    fireEvent.click(toggle);
    expect(screen.getByText('for this task')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        workflow: 'feature',
        task: 'Сделать вход',
        autoDeliver: false,
      }),
    );
    await screen.findByText('manual delivery');
  });

  it('shows the setting of the repository as the state of an untouched switch', async () => {
    show(queueOf({ autoDeliver: false }));
    const toggle = await screen.findByRole('switch', { name: 'Auto delivery' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('returns an item to the setting with null when it is edited', async () => {
    const api = show(queueOf({ items: [queueItem('q1', 'A', 1, { autoDeliver: true })] }));
    await screen.findByText('auto delivery');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const toggles = await screen.findAllByRole('switch', { name: 'Auto delivery' });
    expect(toggles).toHaveLength(2);
    const resets = screen.getAllByRole('button', { name: 'as in the settings' });
    fireEvent.click(resets[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith('q1', {
        workflow: 'feature',
        task: 'A',
        title: null,
        autoDeliver: null,
        tags: [],
      }),
    );
  });
});

describe('items', () => {
  it('edits in place and keeps the draft over events', async () => {
    const api = show();
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(
      within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }),
    );
    const field = await screen.findAllByLabelText('Task text');
    const editor = field.find((node) => (node as HTMLTextAreaElement).value === 'A')!;
    fireEvent.change(editor, { target: { value: 'A2' } });
    act(() => {
      stream().open();
      stream().send({ event: 'queue', seq: 5, queue: queueOf({ items: items('A', 'B', 'C') }) });
    });
    expect((editor as HTMLTextAreaElement).value).toBe('A2');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith('q1', {
        workflow: 'feature',
        task: 'A2',
        title: null,
        autoDeliver: null,
        tags: [],
      }),
    );
  });

  it('shows an error when the item already became a run', async () => {
    const api = show(queueOf({ items: items('A', 'B') }), {
      queueEdit: vi.fn(async () => {
        throw new ApiError(404, 'unknown queue item');
      }),
    });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    (api.queue as ReturnType<typeof vi.fn>).mockResolvedValue(
      queueOf({ items: items('B').map((item) => ({ ...item, id: 'q2' })) }),
    );
    fireEvent.click(
      within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('unknown queue item');
    await waitFor(() => expect(labels()).toEqual(['1. B']));
  });

  it('removes after the confirmation only', async () => {
    const api = show(queueOf({ items: items('A') }), {
      queueRemove: vi.fn(async () => queueOf()),
    });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const refuse = await screen.findByRole('button', { name: 'Keep' });
    expect(document.activeElement).toBe(refuse);
    fireEvent.click(refuse);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.queueRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Remove the task “A” from the queue?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.queueRemove).toHaveBeenCalledWith('q1'));
    await screen.findByText('The queue is empty');
  });

  it('runs now and links the run', async () => {
    const api = show(queueOf({ items: items('A') }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(api.queueRunNow).toHaveBeenCalledWith('q1'));
    const link = await screen.findByRole('link', { name: 'run run9' });
    expect(link.getAttribute('href')).toBe('#runs/run9');
  });
});

describe('added time and run now over the limit', () => {
  it('shows only the time of a task added today and the day of an older one', async () => {
    const today = new Date().setHours(12, 0, 0, 0);
    const old = Date.now() - 3 * 24 * 3600_000;
    show(
      queueOf({
        items: [
          queueItem('q1', 'A', 1, { createdAt: today }),
          queueItem('q2', 'B', 2, { createdAt: old }),
        ],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const [first, second] = Array.from(document.querySelectorAll('time'));
    expect(first!.textContent).not.toContain('/');
    expect(first!.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(second!.textContent).toMatch(/\d{2}\/\d{2}.*\d{1,2}:\d{2}/);
    expect(first!.getAttribute('datetime')).toBe(new Date(today).toISOString());
    expect(second!.getAttribute('datetime')).toBe(new Date(old).toISOString());
    expect(second!.getAttribute('title')).toContain(String(new Date(old).getFullYear()));
  });

  it('warns on the run now button when every place is taken', async () => {
    show(
      queueOf({
        status: 'running',
        parallel: 2,
        runs: [queueRun('run1'), queueRun('run2')],
        items: items('A'),
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(screen.getByRole('button', { name: 'Run now' }).getAttribute('title')).toBe(
      'Over the limit: 3 of 2 places',
    );
  });

  it('gives no warning while a place is free', async () => {
    show(
      queueOf({
        status: 'running',
        parallel: 2,
        runs: [queueRun('run1')],
        items: items('A'),
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(screen.getByRole('button', { name: 'Run now' }).getAttribute('title')).toBeNull();
  });

  it('shows three runs of two places after run now', async () => {
    const full = queueOf({
      status: 'running',
      parallel: 2,
      runs: [queueRun('run1'), queueRun('run2')],
      items: items('A'),
    });
    const over = queueOf({
      status: 'running',
      parallel: 2,
      runs: [queueRun('run1'), queueRun('run2'), queueRun('run9')],
    });
    const queue = vi.fn(async () => full);
    show(full, { queue });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    queue.mockImplementation(async () => over);
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await screen.findByText(/3 of 2 places/);
    expect(screen.getByText(/More runs than places/)).toBeTruthy();
  });
});

describe('order', () => {
  const dataTransfer = () => {
    const data: Record<string, string> = {};
    return {
      setData: (type: string, value: string) => (data[type] = value),
      getData: (type: string) => data[type] ?? '',
      effectAllowed: '',
    };
  };

  function drag(from: HTMLElement, to: HTMLElement, clientY: number) {
    const transfer = dataTransfer();
    fireEvent.dragStart(from, { dataTransfer: transfer });
    fireEvent.dragOver(to, { dataTransfer: transfer, clientY });
    return () => fireEvent.drop(to, { dataTransfer: transfer, clientY });
  }

  it('drags C above A: the order changes at once and is sent as a position', async () => {
    let finish: (queue: ReturnType<typeof queueOf>) => void = () => undefined;
    const api = show(undefined, {
      queueEdit: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const rows = screen.getAllByRole('listitem');
    const drop = drag(rows[2]!, rows[0]!, -1);
    expect(rows[0]!.className).toContain('border-t-primary');
    drop();
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalledWith('q3', { position: 1 }));
    expect(labels()).toEqual(['1. C', '2. A', '3. B']);
    await act(async () => {
      finish(
        queueOf({
          items: [queueItem('q3', 'C', 1), queueItem('q1', 'A', 2), queueItem('q2', 'B', 3)],
        }),
      );
    });
    await waitFor(() => expect(labels()).toEqual(['1. C', '2. A', '3. B']));
  });

  it('puts the item back and shows the error when the move fails', async () => {
    const api = show(undefined, {
      queueEdit: vi.fn(async () => {
        throw new ApiError(400, 'position must be an integer from 1 to 3');
      }),
    });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const rows = screen.getAllByRole('listitem');
    drag(rows[2]!, rows[0]!, -1)();
    await screen.findByText(/Could not reorder: position must be/);
    await waitFor(() => expect(labels()).toEqual(['1. A', '2. B', '3. C']));
    expect(api.queueEdit).toHaveBeenCalledTimes(1);
  });

  it('names the chosen repository in two moves in a row while the unscoped queue request fails', async () => {
    window.localStorage.setItem('aip.web.repository', JSON.stringify('/work/lib'));
    const api = fakeApi({
      queue: vi.fn(async () => {
        throw new ApiError(500, 'boom');
      }),
      queueEdit: vi.fn(async () =>
        queueOf({ repository: '/work/lib', items: items('B', 'A', 'C') }),
      ),
    });
    render(<App api={api} openStream={openFake} />);
    act(() => {
      stream().open();
      stream().send({
        event: 'snapshot',
        seq: 1,
        runs: [],
        queues: [queueOf({ repository: '/work/lib', items: items('A', 'B', 'C') })],
        repositories: [{ path: '/work/lib', addedAt: 1, unfinished: 0, waiting: 0, queued: 3 }],
      });
    });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    for (const row of [1, 2]) {
      const rows = screen.getAllByRole('listitem');
      fireEvent.keyDown(rows[row]!, { key: 'ArrowUp', altKey: true });
      await waitFor(() => expect(api.calls.filter(([n]) => n === 'queueEdit')).toHaveLength(row));
    }
    const edits = api.calls.filter(([name]) => name === 'queueEdit');
    expect(edits).toEqual([
      ['queueEdit', '/work/lib'],
      ['queueEdit', '/work/lib'],
    ]);
    expect(screen.queryByText(/Could not reorder/)).toBeNull();
  });

  it('does nothing when an item is dropped where it was', async () => {
    const api = show();
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const rows = screen.getAllByRole('listitem');
    drag(rows[1]!, rows[1]!, 5)();
    expect(api.queueEdit).not.toHaveBeenCalled();
  });

  it('moves the focused item with Alt+ArrowUp and Alt+ArrowDown, and has no move buttons', async () => {
    const same = queueOf({ items: items('A', 'B', 'C') });
    const api = show(same, { queueEdit: vi.fn(async () => same) });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(screen.queryByRole('button', { name: /\bup\b|\bdown\b|↑|↓/i })).toBeNull();
    const rows = screen.getAllByRole('listitem');
    fireEvent.keyDown(rows[1]!, { key: 'ArrowUp' });
    expect(api.queueEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(rows[1]!, { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(api.queueEdit).toHaveBeenLastCalledWith('q2', { position: 1 }));
    fireEvent.keyDown(rows[1]!, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(api.queueEdit).toHaveBeenLastCalledWith('q2', { position: 3 }));
    fireEvent.keyDown(rows[2]!, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp', altKey: true });
    expect(api.queueEdit).toHaveBeenCalledTimes(2);
  });
});

describe('store', () => {
  it('takes the queue from the snapshot and from queue events', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    const { renderHook } = await import('./render.tsx');
    const { result } = renderHook(() => useRuns(api, openFake));
    await waitFor(() => expect(result.current.queue).not.toBeNull());
    act(() => {
      stream().open();
      stream().send({
        event: 'snapshot',
        seq: 1,
        runs: [],
        queues: [queueOf({ items: items('A') })],
      });
    });
    await waitFor(() => expect(result.current.queue?.items).toHaveLength(1));
    act(() =>
      stream().send({ event: 'queue', seq: 2, queue: queueOf({ items: items('A', 'B') }) }),
    );
    await waitFor(() => expect(result.current.queue?.items).toHaveLength(2));
    act(() =>
      stream().send({ event: 'queue', seq: 3, queue: { ...queueOf(), repository: '/other' } }),
    );
    expect(result.current.queue?.items).toHaveLength(2);
  });

  it('keeps home empty when only a queue of a chosen repository arrived', async () => {
    const api = fakeApi({
      queue: vi.fn(async () => {
        throw new ApiError(500, 'boom');
      }),
    });
    const { renderHook } = await import('./render.tsx');
    const { result } = renderHook(() => useRuns(api, openFake));
    await waitFor(() => expect(api.queue).toHaveBeenCalled());
    act(() => result.current.setQueue({ ...queueOf(), repository: '/other' }));
    expect(result.current.home).toBeNull();
  });

  it('follows the selected repository and loads a queue it does not have yet', async () => {
    const lib = queueOf({ repository: '/other', items: items('L') });
    const bound = vi.fn(async () => lib);
    const api = fakeApi({ queue: vi.fn(async () => queueOf({ items: items('A') })) });
    const scoped = { ...api, queue: bound } as typeof api;
    api.forRepository = () => scoped;
    const { renderHook } = await import('./render.tsx');
    const { result, rerender } = renderHook(
      ({ wanted }: { wanted: string | null }) => useRuns(api, openFake, wanted),
      { initialProps: { wanted: null as string | null } },
    );
    await waitFor(() => expect(result.current.home).toBe('/repo'));
    expect(result.current.queue?.items).toHaveLength(1);
    // unknown to the panel: the home repository stays selected
    rerender({ wanted: '/other' });
    expect(result.current.selected).toBe('/repo');
    act(() =>
      stream().send({
        event: 'repositories',
        seq: 1,
        repositories: [{ path: '/other', addedAt: 1, unfinished: 1, waiting: 0, queued: 0 }],
      }),
    );
    await waitFor(() => expect(result.current.selected).toBe('/other'));
    await waitFor(() => expect(result.current.queue?.items).toHaveLength(1));
    expect(result.current.queue?.repository).toBe('/other');
    expect(bound).toHaveBeenCalledTimes(1);
    expect(result.current.repositories).toEqual(['/repo', '/other']);
  });

  it('polls the queue while the stream is down', async () => {
    vi.useFakeTimers();
    let current = queueOf();
    const api = fakeApi({ queue: vi.fn(async () => current) });
    const { renderHook } = await import('./render.tsx');
    const { result } = renderHook(() => useRuns(api, openFake));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.queue?.items).toEqual([]);
    act(() => stream().fail());
    current = queueOf({ items: items('A') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(result.current.connection).toBe('polling');
    expect(result.current.queue?.items).toHaveLength(1);
    current = queueOf({ items: items('A', 'B') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(result.current.queue?.items).toHaveLength(2);
  });
});

describe('workflows', () => {
  it('offers the workflows of the repository', async () => {
    show(queueOf(), {
      workflows: vi.fn(async () =>
        workflowsView({
          workflows: [
            { ...workflowsView().workflows[0]!, id: 'feature' },
            { ...workflowsView().workflows[0]!, id: 'fix' },
          ],
        }),
      ),
    });
    const trigger = await screen.findByRole('combobox', { name: 'Workflow' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('option', { name: 'fix' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'feature',
      'fix',
    ]);
  });
});

describe('tags in the queue', () => {
  const auth = { id: 'ta', name: 'auth', color: 'red' as const };
  const v2 = { id: 'tv', name: 'v2', color: 'blue' as const };

  /** Shows the queue page; the first snapshot brings the catalog. */
  function withTags(queue = queueOf({ items: items('A', 'B') }), overrides = {}) {
    const api = show(queue, overrides);
    act(() => {
      stream().open();
      stream().send({ event: 'snapshot', seq: 1, runs: [], tags: [auth, v2] });
    });
    return api;
  }
  const pick = async (...names: string[]) => {
    fireEvent.click(await screen.findByRole('combobox', { name: 'Tags' }));
    for (const name of names) fireEvent.click(await screen.findByRole('option', { name }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  };

  it('centres the label on the compact field', async () => {
    withTags(queueOf());
    const picker = (await screen.findByRole('combobox', { name: 'Tags' })).parentElement!;
    const wrapper = picker.parentElement!.parentElement!;
    const row = wrapper.parentElement!;
    const label = row.querySelector('label')!;
    expect(row.classList.contains('items-center')).toBe(true);
    expect(row.classList.contains('items-start')).toBe(false);
    expect(label.classList.contains('pt-1.5')).toBe(false);
    expect(wrapper.classList.contains('max-w-xl')).toBe(true);
    expect(wrapper.classList.contains('flex-1')).toBe(false);
  });

  it('adds a task with two tags', async () => {
    const api = withTags(queueOf());
    const text = await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Workflow' }).textContent).toBe('feature'),
    );
    fireEvent.change(text, { target: { value: 'Сделать вход' } });
    await pick('auth', 'v2');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        workflow: 'feature',
        task: 'Сделать вход',
        tags: ['auth', 'v2'],
      }),
    );
  });

  it('sends an empty list when all tags of an item are removed', async () => {
    const api = withTags(queueOf({ items: [queueItem('q1', 'A', 1, { tags: [auth] })] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove tag auth' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith('q1', expect.objectContaining({ tags: [] })),
    );
  });

  it('keeps the chosen tags of a draft over queue events', async () => {
    withTags(queueOf());
    await screen.findByLabelText('Task text');
    await pick('auth');
    act(() => stream().send({ event: 'queue', seq: 5, queue: queueOf() }));
    const field = screen.getByRole('combobox', { name: 'Tags' }).parentElement!;
    expect(within(field).getByText('auth')).toBeTruthy();
  });

  it('shows the tags of an item after its title and the tags of a running task', async () => {
    withTags(
      queueOf({
        items: [queueItem('q1', 'A', 1, { tags: [auth, v2] })],
        runs: [queueRun('r1', { tags: [v2] })],
        status: 'running',
      }),
    );
    const list = await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(within(list).getByText('auth')).toBeTruthy();
    expect(within(list).getByText('v2')).toBeTruthy();
    const card = screen.getByRole('group', { name: 'r1' });
    const tag = within(card).getByText('v2');
    const row = tag.closest('div')!;
    expect(row.contains(within(card).getByRole('link', { name: 'r1' }))).toBe(false);
    expect(row.contains(within(card).getByText('Active'))).toBe(true);
  });
});

const model = (extra = {}) => queueItem('q1', 'модель данных', 1, { title: 'Модель', ...extra });
const apiItem = (extra = {}) =>
  queueItem('q2', 'api', 2, {
    title: 'API',
    readiness: 'waiting',
    after: [dependency('item', 'q1', 'Модель')],
    ...extra,
  });
const uiItem = (extra = {}) =>
  queueItem('q3', 'ui', 3, {
    title: 'UI',
    readiness: 'waiting',
    after: [dependency('item', 'q2', 'API')],
    ...extra,
  });

const row = (title: string) => {
  const list = screen.getByRole('list', { name: 'tasks in the queue' });
  const found = within(list)
    .getAllByRole('listitem')
    .find((node) => (node.getAttribute('aria-label') ?? '').endsWith(` ${title}`));
  if (!found) throw new Error(`no row ${title}`);
  return found;
};

const pick = async (picker: HTMLElement, title: string) => {
  fireEvent.click(picker);
  const option = await screen.findByRole('option', { name: new RegExp(title) });
  fireEvent.click(option);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
};

const editRow = async (title: string) => {
  fireEvent.click(within(row(title)).getByRole('button', { name: 'Edit' }));
  await within(row(title))
    .findByRole('form')
    .catch(() => undefined);
};

describe('queue links', () => {
  const chain = queueOf({
    items: [model(), apiItem(), uiItem(), queueItem('q4', 'other', 4)],
    runs: [queueRun('run1', { title: 'Запуск' })],
  });

  it('finds dependents, the related set and the depth of a chain', () => {
    expect(dependents(chain, 'q1').map((item) => item.id)).toEqual(['q2']);
    expect([...related(chain, 'q2')].sort()).toEqual(['q1', 'q2', 'q3']);
    expect([...related(chain, 'q4')]).toEqual(['q4']);
    expect([depth(chain, 'q1'), depth(chain, 'q2'), depth(chain, 'q3')]).toEqual([0, 1, 2]);
  });

  it('branches: one task waits for two, both are related', () => {
    const queue = queueOf({
      items: [
        model(),
        queueItem('q2', 'b', 2),
        queueItem('q3', 'c', 3, {
          after: [dependency('item', 'q1', 'Модель'), dependency('item', 'q2', 'b')],
        }),
      ],
    });
    expect([...related(queue, 'q3')].sort()).toEqual(['q1', 'q2', 'q3']);
    expect([...related(queue, 'q1')].sort()).toEqual(['q1', 'q3']);
    expect(depth(queue, 'q3')).toBe(1);
  });

  it('counts a run as related but not in the depth, and caps the depth at three', () => {
    const queue = queueOf({
      items: [
        queueItem('q1', 'a', 1, { after: [dependency('run', 'run1', 'Запуск')] }),
        queueItem('q2', 'b', 2, { after: [dependency('item', 'q1', 'a')] }),
        queueItem('q3', 'c', 3, { after: [dependency('item', 'q2', 'b')] }),
        queueItem('q4', 'd', 4, { after: [dependency('item', 'q3', 'c')] }),
        queueItem('q5', 'e', 5, { after: [dependency('item', 'q4', 'd')] }),
      ],
    });
    expect(related(queue, 'q1').has('run1')).toBe(true);
    expect(depth(queue, 'q1')).toBe(0);
    expect(depth(queue, 'q5')).toBe(3);
  });

  it('lists the unmet predecessors', () => {
    const item = queueItem('q1', 'a', 1, {
      after: [dependency('item', 'q0', 'x', 'done'), dependency('run', 'r', 'y', 'blocked')],
    });
    expect(unmet(item).map((ref) => ref.id)).toEqual(['r']);
  });

  it('offers items, runs and current predecessors once, without the edited item', () => {
    const edited = apiItem({ after: [dependency('run', 'gone', 'Упавший', 'blocked')] });
    const queue = queueOf({
      items: [model(), edited],
      runs: [queueRun('run1', { title: 'Запуск' })],
    });
    const options = afterOptions(queue, (item) => item.title ?? '', edited);
    expect(options.map((option) => option.id)).toEqual(['q1', 'run1', 'gone']);
    expect(options[2]!.title).toBe('Упавший');
    expect(afterOptions(queue, (item) => item.title ?? '').map((option) => option.id)).toEqual([
      'q1',
      'q2',
      'run1',
    ]);
  });
});

describe('dependencies in the form', () => {
  it('adds a task after another', async () => {
    const api = show(queueOf({ items: [model()] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'API' } });
    await pick(screen.getByRole('combobox', { name: 'Waits for' }), 'Модель');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        workflow: 'feature',
        task: 'API',
        after: ['q1'],
      }),
    );
  });

  it('removes all predecessors with an empty list', async () => {
    const api = show(queueOf({ items: [model(), apiItem()] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('API');
    const chip = await screen.findByRole('button', { name: 'Remove Модель' });
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalled());
    expect((api.queueEdit as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      after: [],
    });
  });

  it('does not send after when only the text changed', async () => {
    const api = show(queueOf({ items: [model(), apiItem()] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('API');
    const editor = (await screen.findAllByLabelText('Task text')).find(
      (node) => (node as HTMLTextAreaElement).value === 'api',
    )!;
    fireEvent.change(editor, { target: { value: 'api 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalled());
    const body = (api.queueEdit as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(body.task).toBe('api 2');
    expect('after' in body).toBe(false);
  });

  it('does not send after when nothing is chosen', async () => {
    const api = show(queueOf({ items: [model()] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'API' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect('after' in (api.queueAdd as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(false);
  });

  it('groups a predecessor that left the queue under current predecessors', async () => {
    const failed = apiItem({
      readiness: 'blocked',
      after: [dependency('run', 'run7', 'Упавший', 'blocked')],
    });
    show(queueOf({ items: [model(), failed] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('API');
    const picker = (await screen.findAllByRole('combobox', { name: 'Waits for' }))[1]!;
    fireEvent.click(picker);
    await screen.findByRole('option', { name: /Модель/ });
    expect(screen.getByText('Current predecessors')).toBeTruthy();
    expect(screen.getByText('Waiting tasks')).toBeTruthy();
  });

  it('has no current group when the predecessor is a waiting task', async () => {
    show(
      queueOf({
        items: [model(), apiItem()],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('API');
    const picker = (await screen.findAllByRole('combobox', { name: 'Waits for' }))[1]!;
    fireEvent.click(picker);
    await screen.findAllByRole('option');
    expect(screen.queryByText('Current predecessors')).toBeNull();
  });

  it('offers a predecessor that no longer holds a place and removes it', async () => {
    const failed = apiItem({
      readiness: 'blocked',
      after: [dependency('run', 'run7', 'Модель', 'blocked')],
    });
    const api = show(queueOf({ items: [failed] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('API');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Модель' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalled());
    expect((api.queueEdit as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      after: [],
    });
  });

  it('keeps the choice over a queue event', async () => {
    show(queueOf({ items: [model(), queueItem('q2', 'api', 2, { title: 'API' })] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('API');
    const pickers = await screen.findAllByRole('combobox', { name: 'Waits for' });
    await pick(pickers[1]!, 'Модель');
    expect(screen.getAllByRole('button', { name: 'Remove Модель' })).toHaveLength(1);
    act(() => {
      stream().open();
      stream().send({
        event: 'queue',
        seq: 5,
        queue: queueOf({ items: [model(), queueItem('q2', 'api', 2, { title: 'API' })] }),
      });
    });
    expect(screen.getAllByRole('button', { name: 'Remove Модель' })).toHaveLength(1);
  });

  it('shows a cycle error at the form and keeps the choice', async () => {
    const api = show(queueOf({ items: [model(), apiItem()] }), {
      queueEdit: vi.fn(async () => {
        throw new ApiError(400, 'dependency cycle: q1 -> q2 -> q1');
      }),
    });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('Модель');
    const pickers = await screen.findAllByRole('combobox', { name: 'Waits for' });
    await pick(pickers[1]!, 'API');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('dependency cycle: q1 -> q2 -> q1');
    expect(api.queueEdit).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove API' })).toBeTruthy();
  });
});

describe('dependencies in the list', () => {
  it('shows a label with a link for a running predecessor run', async () => {
    show(
      queueOf({
        items: [apiItem({ after: [dependency('run', 'run1', 'Модель')] })],
        runs: [queueRun('run1', { title: 'Модель' })],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const link = within(row('API')).getByRole('link', { name: /after: Модель/ });
    expect(link.getAttribute('href')).toBe('#runs/run1');
    expect(link.getAttribute('data-state')).toBe('waiting');
    expect(link.textContent).toContain('waiting');
  });

  it('shows waiting readiness with the predecessor in the hint', async () => {
    show(
      queueOf({
        items: [apiItem({ after: [dependency('run', 'run1', 'Модель')] })],
        runs: [queueRun('run1', { title: 'Модель' })],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const badge = within(row('API')).getByText('waiting', {
      selector: '[data-readiness] *, [data-readiness]',
    });
    const holder = badge.closest('[data-readiness]')!;
    expect(holder.getAttribute('data-readiness')).toBe('waiting');
    expect(holder.getAttribute('title')).toContain('Модель');
  });

  it('marks a blocked task and its failed predecessor', async () => {
    show(
      queueOf({
        items: [
          apiItem({
            readiness: 'blocked',
            after: [dependency('run', 'run1', 'Модель', 'blocked')],
          }),
        ],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const li = row('API');
    expect(li.className).toContain('border-destructive');
    expect(li.querySelector('[data-readiness="blocked"]')).toBeTruthy();
    expect(li.querySelector('a[data-state="blocked"]')).toBeTruthy();
  });

  it('shows an independent task as ready and without labels', async () => {
    show(queueOf({ items: [model()] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const li = row('Модель');
    expect(li.querySelector('[data-readiness="ready"]')).toBeTruthy();
    expect(li.querySelector('[data-state]:not([aria-label^="Workflow"])')).toBeNull();
    expect(li.className).not.toContain('border-destructive');
  });

  it('explains in the hint that a ready task has nothing to wait for', async () => {
    show(queueOf({ items: [model()] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const badge = row('Модель').querySelector('[data-readiness="ready"]')!;
    expect(badge.getAttribute('title')).toContain('Nothing to wait for');
  });

  it('does not light up a task without links', async () => {
    show(
      queueOf({
        status: 'running',
        runs: [queueRun('run1', { title: 'Запуск' })],
        items: [model()],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.mouseEnter(row('Модель'));
    expect(row('Модель').hasAttribute('data-highlighted')).toBe(false);
    expect(screen.getByRole('group', { name: 'Запуск' }).hasAttribute('data-highlighted')).toBe(
      false,
    );
  });

  it('keeps the highlight when focus moves to a button of the row', async () => {
    show(queueOf({ items: [model(), apiItem()] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.focus(row('API'));
    const edit = within(row('API')).getByRole('button', { name: 'Edit' });
    fireEvent.blur(row('API'), { relatedTarget: edit });
    for (const title of ['Модель', 'API'])
      expect(row(title).hasAttribute('data-highlighted')).toBe(true);
    fireEvent.blur(row('API'), { relatedTarget: document.body });
    expect(row('API').hasAttribute('data-highlighted')).toBe(false);
  });

  it('highlights the chain and indents branches by depth', async () => {
    show(queueOf({ items: [model(), apiItem(), uiItem(), queueItem('q4', 'other', 4)] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(row('API').getAttribute('data-depth')).toBe('1');
    expect(row('UI').getAttribute('data-depth')).toBe('2');
    expect(row('Модель').getAttribute('data-depth')).toBe('0');
    fireEvent.mouseEnter(row('API'));
    for (const title of ['Модель', 'API', 'UI'])
      expect(row(title).hasAttribute('data-highlighted')).toBe(true);
    expect(row('other').hasAttribute('data-highlighted')).toBe(false);
    fireEvent.mouseLeave(row('API'));
    expect(row('API').hasAttribute('data-highlighted')).toBe(false);
  });

  it('highlights the card of a predecessor run on focus and not while dragging', async () => {
    show(
      queueOf({
        status: 'running',
        runs: [queueRun('run1', { title: 'Модель' })],
        items: [apiItem({ after: [dependency('run', 'run1', 'Модель')] })],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const card = screen.getByRole('group', { name: 'Модель' });
    expect(card.hasAttribute('data-highlighted')).toBe(false);
    fireEvent.focus(row('API'));
    expect(card.hasAttribute('data-highlighted')).toBe(true);
    fireEvent.blur(row('API'));
    expect(card.hasAttribute('data-highlighted')).toBe(false);
    fireEvent.dragStart(row('API'), { dataTransfer: { setData: vi.fn() } });
    fireEvent.focus(row('API'));
    expect(card.hasAttribute('data-highlighted')).toBe(false);
  });
});

describe('confirmations with dependencies', () => {
  const waiting = () =>
    queueOf({ items: [apiItem({ after: [dependency('run', 'run1', 'Модель')] })] });

  it('asks before running a waiting task, then runs it', async () => {
    const api = show(waiting());
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Dependencies are not met');
    expect(dialog.textContent).toContain('Модель');
    expect(api.queueRunNow).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(api.queueRunNow).toHaveBeenCalledWith('q2'));
    expect((await screen.findByRole('link', { name: 'run run9' })).getAttribute('href')).toBe(
      '#runs/run9',
    );
  });

  it('sends nothing when the dialog is refused', async () => {
    const api = show(waiting());
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.queueRunNow).not.toHaveBeenCalled();
    expect(labels()).toEqual(['1. API']);
  });

  it('names the dependents when a predecessor is removed', async () => {
    const api = show(queueOf({ items: [model(), apiItem()] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(within(row('Модель')).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('API');
    expect(dialog.textContent).toContain('will stop waiting');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep' }));
    expect(api.queueRemove).not.toHaveBeenCalled();
  });
});

describe('queue layout', () => {
  let restore = () => {};
  afterEach(() => restore());

  const running = () =>
    queueOf({
      status: 'running',
      parallel: 3,
      runs: [queueRun('r1'), queueRun('r2'), queueRun('r3')],
      items: items('A'),
    });

  it('puts the controls in a column and the runs in a grid in a wide window', async () => {
    restore = setWindowWidth(1600);
    show(running());
    const controls = await screen.findByRole('region', { name: 'queue settings' });
    expect(controls.parentElement?.className).toContain('lg:grid-cols-[18rem_minmax(0,1fr)]');
    expect(within(controls).getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(within(controls).getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(within(controls).getByLabelText('Parallelism')).toBeTruthy();
    const runs = screen.getByRole('region', { name: 'running from the queue' });
    expect(controls.contains(runs)).toBe(false);
    expect(within(runs).getByRole('list').className).toContain('md:grid-cols-2');
    expect(within(runs).getByRole('list').className).toContain('2xl:grid-cols-3');
    const order = [runs, screen.getByRole('region', { name: 'waiting to start' })];
    expect(
      order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('stacks the controls over the content in a narrow window', async () => {
    restore = setWindowWidth(600);
    show(running());
    const controls = await screen.findByRole('region', { name: 'queue settings' });
    const runs = screen.getByRole('region', { name: 'running from the queue' });
    expect(controls.compareDocumentPosition(runs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(runs).getByRole('list').className).toContain('grid-cols-1');
  });
});

describe('queue settings block', () => {
  const settingsBlock = async () =>
    within(await screen.findByRole('region', { name: 'queue settings' }));

  it('shows the badge, start, pause, parallelism and three switches with hints', async () => {
    show(queueOf({ items: items('A') }));
    const block = await settingsBlock();
    expect(block.getByText('Stopped')).toBeTruthy();
    expect(block.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(block.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(block.getByLabelText('Parallelism')).toBeTruthy();
    for (const name of ['Autopilot', 'Skip failed', 'Auto delivery by default']) {
      expect(block.getByRole('switch', { name })).toBeTruthy();
    }
    expect(block.getByText(/does not stop when it becomes empty/)).toBeTruthy();
    expect(block.getByText(/leaves its place/)).toBeTruthy();
    expect(block.getByText(/tasks without their own auto delivery/)).toBeTruthy();
  });

  it('sends only skipFailed when the switch is turned on', async () => {
    const api = show(queueOf({ parallel: 2 }), {
      queueSettings: vi.fn(async () => queueOf({ parallel: 2, skipFailed: true })),
    });
    const block = await settingsBlock();
    const toggle = block.getByRole('switch', { name: 'Skip failed' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(api.queueSettings).toHaveBeenCalledWith({ skipFailed: true }));
    await waitFor(() =>
      expect(block.getByRole('switch', { name: 'Skip failed' }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
    expect(block.getByRole('switch', { name: 'Autopilot' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(api.queueSettings).toHaveBeenCalledTimes(1);
  });

  it('turns the autopilot on in a stopped queue and moves the task to the running block', async () => {
    const api = show(queueOf({ items: items('A') }), {
      queueSettings: vi.fn(async () =>
        queueOf({
          status: 'running',
          autopilot: true,
          runs: [queueRun('run1', { title: 'Вход' })],
        }),
      ),
    });
    const block = await settingsBlock();
    fireEvent.click(block.getByRole('switch', { name: 'Autopilot' }));
    await waitFor(() => expect(api.queueSettings).toHaveBeenCalledWith({ autopilot: true }));
    await screen.findByRole('region', { name: 'running from the queue' });
    expect(block.getByText('Running')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Вход' })).toBeTruthy();
  });

  it('returns the switch and shows the error when the server refuses', async () => {
    show(queueOf(), {
      queueSettings: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const block = await settingsBlock();
    fireEvent.click(block.getByRole('switch', { name: 'Autopilot' }));
    await screen.findByText('boom');
    expect(block.getByRole('switch', { name: 'Autopilot' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('follows the queue event', async () => {
    show(queueOf());
    const block = await settingsBlock();
    act(() => {
      stream().open();
      stream().send({
        event: 'queue',
        seq: 5,
        queue: queueOf({ autopilot: true, skipFailed: true }),
      });
    });
    await waitFor(() =>
      expect(block.getByRole('switch', { name: 'Autopilot' }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
    expect(block.getByRole('switch', { name: 'Skip failed' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('writes delivery.auto to the global settings when auto delivery is turned off', async () => {
    const api = show(queueOf({ autoDeliver: true }));
    const block = await settingsBlock();
    const toggle = await waitFor(() => {
      const found = block.getByRole<HTMLButtonElement>('switch', {
        name: 'Auto delivery by default',
      });
      expect(found.disabled).toBe(false);
      return found;
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.auto', false, 'g1', 'global'),
    );
    act(() => {
      stream().open();
      stream().send({ event: 'queue', seq: 5, queue: queueOf({ autoDeliver: false }) });
    });
    await waitFor(() =>
      expect(
        block
          .getByRole('switch', { name: 'Auto delivery by default' })
          .getAttribute('aria-checked'),
      ).toBe('false'),
    );
  });

  it('shows the value from the project file as unavailable with a hint', async () => {
    show(queueOf({ autoDeliver: false }), {
      config: vi.fn(async () =>
        configView({
          settings: settingsOf({
            'delivery.auto': {
              path: 'delivery.auto',
              value: false,
              file: '/repo/aip/settings.yaml',
            },
          }),
        }),
      ),
    });
    const block = await settingsBlock();
    const toggle = block.getByRole<HTMLButtonElement>('switch', {
      name: 'Auto delivery by default',
    });
    await waitFor(() => expect(toggle.disabled).toBe(true));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(block.getByText('The project file sets this value')).toBeTruthy();
  });

  it('disables auto delivery while the configuration is invalid', async () => {
    show(queueOf({ autoDeliver: null }));
    const block = await settingsBlock();
    expect(
      block.getByRole<HTMLButtonElement>('switch', { name: 'Auto delivery by default' }).disabled,
    ).toBe(true);
    expect(block.getByText('The configuration is not valid')).toBeTruthy();
  });
});

describe('skipped runs', () => {
  it('shows them under the running block and does not count them as places', async () => {
    show(
      queueOf({
        status: 'running',
        skipFailed: true,
        runs: [queueRun('run2', { title: 'Регистрация' })],
        skipped: [
          queueRun('run1', {
            title: 'Логин',
            state: 'failed',
            problem: { group: 'login', reason: 'failed' },
          }),
        ],
      }),
    );
    const skipped = within(await screen.findByRole('region', { name: 'skipped with a problem' }));
    expect(skipped.getByRole('heading').textContent).toBe('Skipped with a problem (1)');
    const card = within(skipped.getByRole('group', { name: 'Логин' }));
    expect(card.getByText('a group failed', { exact: false })).toBeTruthy();
    expect(card.getByRole('link', { name: /login/ }).getAttribute('href')).toBe(
      formatRoute({ view: 'runs', run: 'run1', group: 'login', step: null }),
    );
    const running = screen.getByRole('region', { name: 'running from the queue' });
    expect(within(running).getByRole('heading').textContent).toContain('1 of 1 place');
    expect(within(running).queryByText('Логин')).toBeNull();
  });

  it('has no block without skipped runs', async () => {
    show(queueOf({ status: 'running' }));
    await screen.findByRole('region', { name: 'queue settings' });
    expect(screen.queryByRole('region', { name: 'skipped with a problem' })).toBeNull();
  });

  it('shows the block of a paused queue without runs', async () => {
    show(queueOf({ skipped: [queueRun('run1', { title: 'Логин', state: 'failed' })] }));
    await screen.findByRole('region', { name: 'skipped with a problem' });
    expect(screen.queryByRole('region', { name: 'running from the queue' })).toBeNull();
  });
});
