// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  previewMarkdown,
  render,
  screen,
  waitFor,
  within,
} from './render.tsx';
import i18next from 'i18next';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { ApiError } from '../src/shared/api/api.ts';
import { dropPosition, dropSlot, moveId } from '../src/shared/lib/listOrder.ts';
import {
  afterOptions,
  dependents,
  depth,
  parentChoices,
  related,
  unmet,
} from '../src/features/queue/queueLinks.ts';
import { parseParallel } from '../src/features/queue/QueuePage.tsx';
import { draftOf, emptyDraft, fieldsOf } from '../src/features/queue/QueueForm.tsx';
import { pruneSkip } from '../src/shared/ui/forms/picker/SkipSteps.tsx';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';
import { useRuns } from '../src/shared/api/runs/useRuns.ts';

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
  pipelineOf,
  variantOf,
  pipelinesView,
} from './fixtures.ts';

beforeEach(() => {
  toast.dismiss();
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

async function openNewTask(): Promise<HTMLElement> {
  // Queries by label: a query by role walks the accessibility tree of the whole page.
  const controls = await screen.findByLabelText('queue controls');
  fireEvent.click(within(controls).getByRole('button', { name: 'New task' }));
  return screen.findByRole('dialog', { name: 'New task' });
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
    expect(parseRoute('#queue')).toEqual({
      view: 'queue',
      run: null,
      group: null,
      step: null,
      tab: null,
    });
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
          queueItem('q2', 'длинный\nтекст', 2, { error: 'unknown pipeline `feature`' }),
          queueItem('q3', 'x', 3, { title: 'Название' }),
        ],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(labels()).toEqual(['1. 2 groups', '2. длинный', '3. Название']);
    expect(screen.getByText(/unknown pipeline/)).toBeTruthy();
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

  it('shows a paused run as a task with a continue button', async () => {
    const api = show(
      queueOf({ items: [queueItem('q1', 'A', 1, { run: 'run7', hold: 'paused' })] }),
    );
    await screen.findByText('On pause');
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(api.queueRunNow).toHaveBeenCalledWith('q1'));
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
            active: [{ group: 'signup', step: 'coder', stepName: 'Кодер' }],
          }),
        ],
      }),
    );
    const card = await screen.findByRole('group', { name: 'Вход' });
    expect(within(card).getByText('feature')).toBeTruthy();
    expect(within(card).getByText('1 of 3 groups · steps 2 of 6')).toBeTruthy();
    expect(within(card).getByText('signup', { selector: 'code' })).toBeTruthy();
    expect(within(card).getByText(/Кодер/)).toBeTruthy();
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
        runs: [queueRun('run1', { title, number: 12 })],
      }),
    );
    const card = await screen.findByRole('group', { name: title });
    expect(within(card).getByText('#12')).toBeTruthy();
    const link = within(card).getByRole('link', { name: title });
    expect(link.getAttribute('title')).toBe(title);
    expect(link.className).toContain('truncate');
    const badge = within(card).getByText('Active');
    expect(link.parentElement?.parentElement).toBe(card);
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
            steps: { done: 1, total: 4, current: { step: 'coder', name: 'Кодер', number: 2 } },
          }),
        ],
      }),
    );
    const card = await screen.findByRole('group', { name: 'Один' });
    expect(within(card).getByText('step 2 of 4 · Кодер')).toBeTruthy();
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
  });

  it('rolls the bar back when a group returns to an earlier step', async () => {
    show(
      queueOf({
        status: 'running',
        runs: [
          queueRun('run1', {
            title: 'Один',
            steps: { done: 1, total: 3, current: { step: 'review', name: 'Ревьюер', number: 2 } },
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
              steps: { done: 0, total: 3, current: { step: 'coder', name: 'Кодер', number: 1 } },
            }),
          ],
        }),
      });
    });
    await screen.findByText('step 1 of 3 · Кодер');
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
        runs: [queueRun('run1', { active: [{ group: 'g', step: 'code', stepName: 'Кодер' }] })],
      }),
    );
    await screen.findByText(/Кодер/);
    act(() => {
      stream().open();
      stream().send({
        event: 'queue',
        seq: 5,
        queue: queueOf({
          status: 'running',
          runs: [
            queueRun('run1', { active: [{ group: 'g', step: 'review', stepName: 'Ревьюер' }] }),
          ],
        }),
      });
    });
    await screen.findByText(/Ревьюер/);
  });
});

describe('pipeline badge in the queue', () => {
  it('stands right after the state badge on the card, not in the time row', async () => {
    show(queueOf({ status: 'running', runs: [queueRun('run1', { title: 'Вход' })] }));
    const card = await screen.findByRole('group', { name: 'Вход' });
    const badge = within(card).getByLabelText('Pipeline: feature');
    const state = within(card).getByText('Active').closest('span')!.parentElement!;
    expect(state.nextElementSibling).toBe(badge);
    expect(badge.parentElement).toBe(state.parentElement);
    const time = within(card).getByText(/^running /).parentElement!;
    expect(time.textContent).not.toContain('feature');
  });

  it('shows the badge in the row of a waiting task', async () => {
    show(queueOf({ items: [queueItem('q1', 'A', 1, { pipeline: 'epic', readiness: 'waiting' })] }));
    const row = await screen.findByRole('listitem', { name: /A/ });
    expect(within(row).getByLabelText('Pipeline: epic')).toBeTruthy();
  });
});

describe('task numbers', () => {
  it('shows the number of a waiting task and of its predecessor', async () => {
    show(
      queueOf({
        items: [
          queueItem('q1', 'A', 1, { number: 7 }),
          queueItem('q2', 'B', 2, {
            number: 8,
            readiness: 'waiting',
            after: [{ ...dependency('item', 'q1', 'A'), number: 7 }],
          }),
        ],
      }),
    );
    const first = await screen.findByRole('listitem', { name: /A/ });
    expect(within(first).getByText('#7')).toBeTruthy();
    const second = await screen.findByRole('listitem', { name: /B/ });
    expect(within(second).getByText('#8')).toBeTruthy();
    expect(within(second).getAllByText(/#7/).length).toBeGreaterThan(0);
  });
});

describe('new task form', () => {
  it('adds a task and clears the form without starting the queue', async () => {
    const api = show(queueOf(), {
      queueAdd: vi.fn(async () => ({ ...queueOf({ items: items('Сделать вход') }), item: 'q1' })),
    });
    await openNewTask();
    const text = await screen.findByLabelText('Task text');
    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    expect(add.disabled).toBe(true);
    fireEvent.change(text, { target: { value: 'Сделать вход' } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({ pipeline: 'feature', task: 'Сделать вход' }),
    );
    await screen.findByLabelText('tasks in the queue');
    await openNewTask();
    expect((screen.getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('');
    expect(api.queueStart).not.toHaveBeenCalled();
  });

  it('announces the created task with its number', async () => {
    show(queueOf(), {
      queueAdd: vi.fn(async () => ({
        ...queueOf({ items: [queueItem('q7', 'Сделать вход', 7)] }),
        item: 'q7',
      })),
    });
    await openNewTask();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(await screen.findByLabelText('Task text'), {
      target: { value: 'Сделать вход' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByText('Task #7 created').length).toBeGreaterThan(0));
  });

  it('announces a created task that is not in the answer without a number', async () => {
    show(queueOf(), {
      queueAdd: vi.fn(async () => ({ ...queueOf(), item: 'gone' })),
    });
    await openNewTask();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(await screen.findByLabelText('Task text'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByText('Task created').length).toBeGreaterThan(0));
  });

  it('does not announce anything when the queue refuses the task', async () => {
    show(queueOf(), {
      queueAdd: vi.fn(async () => {
        throw new ApiError(400, 'unknown pipeline');
      }),
    });
    await openNewTask();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(await screen.findByLabelText('Task text'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/unknown pipeline/);
    expect(screen.queryAllByText(/^Task (#\d+ )?created$/)).toHaveLength(0);
  });

  it('adds a task made of two groups', async () => {
    const api = show(queueOf());
    await openNewTask();
    await screen.findByLabelText('Task text');
    fireEvent.click(screen.getByRole('radio', { name: 'Groups' }));
    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    fireEvent.change(screen.getByLabelText('Title of group 1'), { target: { value: 'Вход' } });
    expect(add.disabled).toBe(false);
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
        pipeline: 'feature',
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
    await openNewTask();
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
        throw new ApiError(400, 'unknown pipeline `feature`; known: none');
      }),
    });
    await openNewTask();
    const text = await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(text, { target: { value: 'Сделать вход' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/unknown pipeline/);
    expect(api.queueAdd).toHaveBeenCalled();
    expect((screen.getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('Сделать вход');
  });

  it('accepts a title without task text and sends the title as task text', async () => {
    const api = show(queueOf());
    await openNewTask();
    await screen.findByLabelText('Task text');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Search  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        title: 'Search',
        task: 'Search',
      }),
    );
  });

  it('accepts group descriptions without titles and preserves blank titles on server error', async () => {
    const api = show(queueOf(), {
      queueAdd: vi.fn(async () => {
        throw new ApiError(400, 'unknown pipeline');
      }),
    });
    await openNewTask();
    await screen.findByLabelText('Task text');
    fireEvent.click(screen.getByRole('radio', { name: 'Groups' }));
    fireEvent.change(screen.getByLabelText('Text of group 1'), {
      target: { value: '\n  First line\n- Markdown body  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/unknown pipeline/);
    expect(api.queueAdd).toHaveBeenCalledWith({
      pipeline: 'feature',
      groups: [{ title: 'First line', task: 'First line\n- Markdown body' }],
    });
    expect((screen.getByLabelText('Title of group 1') as HTMLInputElement).value).toBe('');
  });

  it('keeps the typed text when a queue or run event arrives and when the tab changes', async () => {
    show(queueOf({ items: items('A') }));
    await openNewTask();
    const text = await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(text, { target: { value: 'черновик' } });
    act(() => {
      stream().open();
      stream().send({ event: 'queue', seq: 5, queue: queueOf({ items: items('A', 'Z') }) });
      stream().send({ event: 'run', seq: 6, run: runView() });
    });
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    expect((screen.getByLabelText('Task text') as HTMLTextAreaElement).value).toBe('черновик');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(labels()).toEqual(['1. A', '2. Z']));
    fireEvent.click(screen.getByRole('link', { name: /Runs/ }));
    fireEvent.click(await screen.findByRole('link', { name: /Queue/ }));
    await openNewTask();
    expect(((await screen.findByLabelText('Task text')) as HTMLTextAreaElement).value).toBe(
      'черновик',
    );
  });

  it('keeps the typed text when the language changes and shows the labels in the new one', async () => {
    show(queueOf({ items: items('A') }));
    await openNewTask();
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
    await openNewTask();
    const text = await screen.findByLabelText('Task text');
    const toggle = screen.getByRole('switch', { name: 'Auto delivery' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('as in the settings')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(text, { target: { value: 'Сделать вход' } });
    fireEvent.click(toggle);
    expect(screen.getByText('for this task')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        task: 'Сделать вход',
        autoDeliver: false,
      }),
    );
    await screen.findByText('manual delivery');
  });

  it('shows the setting of the repository as the state of an untouched switch', async () => {
    show(queueOf({ autoDeliver: false }));
    await openNewTask();
    const toggle = await screen.findByRole('switch', { name: 'Auto delivery' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('previews the text of an item as Markdown in the edit form', async () => {
    show(queueOf({ items: [queueItem('q1', '**важно**', 1)] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    previewMarkdown();
    expect((await screen.findByText('важно')).tagName).toBe('STRONG');
  });

  it('keeps the view of a locked form working and its fields unavailable', async () => {
    show(queueOf({ items: [queueItem('q1', '**важно**', 1, { run: 'run7', hold: 'paused' })] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const field = await screen.findByLabelText<HTMLTextAreaElement>('Task text');
    expect(field.disabled).toBe(true);
    previewMarkdown();
    expect((await screen.findByText('важно')).tagName).toBe('STRONG');
    previewMarkdown(null, false);
    expect(field.disabled).toBe(true);
    for (const name of ['Bold', 'Heading', 'Link', 'Code block']) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
  });

  it('locks the group fields of a locked form but not the view', async () => {
    show(
      queueOf({
        items: [
          queueItem('q1', '', 1, {
            run: 'run7',
            hold: 'paused',
            groups: [{ title: 'Вход', task: 'форма' }],
          }),
        ],
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText<HTMLInputElement>('Title of group 1').disabled).toBe(true);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Text of group 1').disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove group 1' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add group' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'MD' }).disabled).toBe(false);
  });

  it('returns an item to the setting with null when it is edited', async () => {
    const api = show(queueOf({ items: [queueItem('q1', 'A', 1, { autoDeliver: true })] }));
    await screen.findByText('auto delivery');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findAllByRole('switch', { name: 'Auto delivery' })).toHaveLength(1);
    const resets = screen.getAllByRole('button', { name: 'as in the settings' });
    fireEvent.click(resets[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith('q1', {
        pipeline: 'feature',
        task: 'A',
        title: null,
        autoDeliver: null,
        deliveryMode: null,
        tags: [],
        skip: [],
      }),
    );
  });
});

describe('items', () => {
  it.each([
    {
      label: 'a title-only group',
      edited: { title: 'Only title', task: '' },
      expected: { title: 'Only title', task: 'Only title' },
    },
    {
      label: 'a description-only group',
      edited: { title: '', task: 'Only description\nMore detail' },
      expected: { title: 'Only description', task: 'Only description\nMore detail' },
    },
  ])('saves $label without losing its independent input', async ({ edited, expected }) => {
    const api = show(
      queueOf({
        items: [
          queueItem('q1', '', 1, {
            task: null,
            groups: [{ title: 'Initial', task: 'Initial' }],
          }),
        ],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(
      within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }),
    );
    const title = await screen.findByLabelText<HTMLInputElement>('Title of group 1');
    const task = screen.getByLabelText<HTMLTextAreaElement>('Text of group 1');
    fireEvent.change(title, { target: { value: edited.title } });
    fireEvent.change(task, { target: { value: edited.task } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ groups: [expected], title: null }),
      ),
    );
  });

  it('clears a non-empty shared title of a task with null', async () => {
    const api = show(queueOf({ items: [queueItem('q1', 'Body', 1, { title: 'Old title' })] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(
      within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }),
    );
    const name = await screen.findByLabelText<HTMLInputElement>('Name');
    expect(name.value).toBe('Old title');
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ task: 'Body', title: null }),
      ),
    );
  });

  it('edits only the title of a task and keeps its text', async () => {
    const api = show(queueOf({ items: [queueItem('q1', 'Body', 1, { title: 'Old title' })] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(
      within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }),
    );
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ task: 'Body', title: 'New title' }),
      ),
    );
  });

  it('clears the text of a task with a title and sends the title as text', async () => {
    const api = show(queueOf({ items: [queueItem('q1', 'Body', 1, { title: 'X' })] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(
      within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }),
    );
    const fields = await screen.findAllByLabelText('Task text');
    const editor = fields.find((node) => (node as HTMLTextAreaElement).value === 'Body')!;
    fireEvent.change(editor, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith('q1', {
        pipeline: 'feature',
        task: 'X',
        title: 'X',
        autoDeliver: null,
        deliveryMode: null,
        tags: [],
        skip: [],
      }),
    );
  });

  it('reopens the edit form with the canonical data after saving', async () => {
    const api = show(
      queueOf({
        items: [
          queueItem('q1', '', 1, {
            task: null,
            groups: [{ title: 'Old', task: 'Old\nrest' }],
          }),
        ],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    const edit = () =>
      fireEvent.click(
        within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }),
      );
    edit();
    fireEvent.change(await screen.findByLabelText('Title of group 1'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Text of group 1'), {
      target: { value: 'Saved first line\nmore' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText('Title of group 1')).toBeNull());
    act(() => {
      stream().open();
      stream().send({
        event: 'queue',
        seq: 5,
        queue: queueOf({
          items: [
            queueItem('q1', '', 1, {
              task: null,
              groups: [{ title: 'Saved first line', task: 'Saved first line\nmore' }],
            }),
          ],
        }),
      });
    });
    await waitFor(() =>
      expect(
        within(screen.getAllByRole('listitem')[0]!).queryByRole('button', { name: 'Edit' }),
      ).not.toBeNull(),
    );
    edit();
    expect((await screen.findByLabelText<HTMLInputElement>('Title of group 1')).value).toBe(
      'Saved first line',
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>('Text of group 1').value).toBe(
      'Saved first line\nmore',
    );
  });

  it('saves a group with only a description: its title comes from the first line', async () => {
    const api = show(
      queueOf({
        items: [
          queueItem('q1', '', 1, {
            task: null,
            groups: [
              { title: 'Only title', task: 'Only title' },
              { title: 'Old title', task: 'Исправить вход\nПроверить ошибку' },
            ],
          }),
        ],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(
      within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }),
    );
    fireEvent.change(await screen.findByLabelText('Title of group 2'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalledTimes(1));
    expect(api.queueEdit).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({
        groups: [
          { title: 'Only title', task: 'Only title' },
          { title: 'Исправить вход', task: 'Исправить вход\nПроверить ошибку' },
        ],
        title: null,
      }),
    );
  });

  it('has no repository field in the form of an item', async () => {
    show();
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(
      within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }),
    );
    await screen.findAllByLabelText('Task text');
    expect(screen.queryByRole('combobox', { name: 'Repository' })).toBeNull();
  });

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
        pipeline: 'feature',
        task: 'A2',
        title: null,
        autoDeliver: null,
        deliveryMode: null,
        tags: [],
        skip: [],
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
    expect(screen.getByRole('button', { name: 'Run now' }).getAttribute('aria-description')).toBe(
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
    expect(
      screen.getByRole('button', { name: 'Run now' }).getAttribute('aria-description'),
    ).toBeNull();
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

describe('pause and freeze of runs', () => {
  it('names the run that run now would freeze instead of warning about the limit', async () => {
    show(
      queueOf({
        status: 'running',
        parallel: 2,
        runs: [queueRun('run1', { number: 4 }), queueRun('run2', { number: 7 })],
        freezeCandidate: 'run2',
        items: items('A'),
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(screen.getByRole('button', { name: 'Run now' }).getAttribute('aria-description')).toBe(
      'Will freeze task #7',
    );
  });

  it('marks a frozen item and continues it without a confirmation', async () => {
    const api = show(
      queueOf({
        status: 'running',
        parallel: 1,
        runs: [queueRun('run9', { priority: true })],
        items: [
          queueItem('q1', 'B', 1, { run: 'run1', hold: 'frozen', readiness: 'waiting' }),
          queueItem('q2', 'C', 2, { run: 'run2', hold: 'paused', readiness: 'waiting' }),
        ],
      }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    expect(screen.getByText('Frozen')).toBeTruthy();
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('Priority')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Continue' });
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(api.queueRunNow).toHaveBeenCalledWith('q1'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pauses a run of the queue from its card', async () => {
    const api = show(
      queueOf({ status: 'running', parallel: 1, runs: [queueRun('run1')], items: items('A') }),
    );
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Pause run' }));
    await waitFor(() => expect(api.pauseRun).toHaveBeenCalledWith('run1', expect.anything()));
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
        repositories: [
          {
            path: '/work/lib',
            displayPath: '/work/lib',
            addedAt: 1,
            unfinished: 0,
            waiting: 0,
            queued: 3,
          },
        ],
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
        repositories: [
          {
            path: '/other',
            displayPath: '/other',
            addedAt: 1,
            unfinished: 1,
            waiting: 0,
            queued: 0,
          },
        ],
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

describe('pipelines', () => {
  it('offers the pipelines of the repository', async () => {
    show(queueOf(), {
      pipelines: vi.fn(async () =>
        pipelinesView({
          pipelines: [
            { ...pipelinesView().pipelines[0]!, id: 'feature' },
            { ...pipelinesView().pipelines[0]!, id: 'fix', name: 'Исправление' },
          ],
        }),
      ),
    });
    await openNewTask();
    const trigger = await screen.findByRole('combobox', { name: 'Pipeline' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('option', { name: 'Исправление' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'feature',
      'Исправление',
    ]);
  });
});

describe('tags in the queue', () => {
  const auth = { id: 'ta', repository: '/repo', name: 'auth', color: 'red' as const, task: null };
  const v2 = { id: 'tv', repository: '/repo', name: 'v2', color: 'blue' as const, task: null };

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

  it('puts the label above the tags field in the settings half next to "Waits for"', async () => {
    withTags(queueOf());
    await openNewTask();
    const tags = await screen.findByRole('combobox', { name: 'Tags' });
    const after = screen.getByRole('combobox', { name: 'Waits for' });
    const column = screen.getByText('Tags', { selector: 'label' }).parentElement!;
    const half = column.parentElement!;
    expect(half.contains(after)).toBe(true);
    expect(half.className).not.toContain('order-');
    expect(column.className).toContain('flex-col');
    expect(column.className).not.toContain('max-w-xl');
    const label = screen.getByText('Tags', { selector: 'label' });
    expect(label.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(after.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('adds a task with two tags', async () => {
    const api = withTags(queueOf());
    await openNewTask();
    const text = await screen.findByLabelText('Task text');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(text, { target: { value: 'Сделать вход' } });
    await pick('auth', 'v2');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
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

  it('sends only ordinary tags when an item with a linked task tag is edited', async () => {
    const linked = {
      id: 'tl',
      repository: '/repo',
      name: 'cards',
      color: 'indigo' as const,
      task: { run: 'run9', number: 115 },
    };
    const api = show(queueOf({ items: [queueItem('q1', 'A', 1, { tags: [linked, auth] })] }));
    act(() => {
      stream().open();
      stream().send({ event: 'snapshot', seq: 1, runs: [], tags: [linked, auth, v2] });
    });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('button', { name: 'Remove tag auth' });
    expect(screen.queryByRole('button', { name: 'Remove tag cards' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag auth' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith('q1', expect.objectContaining({ tags: [] })),
    );
  });

  it('keeps the chosen tags of a draft over queue events', async () => {
    withTags(queueOf());
    await openNewTask();
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
  await screen.findByRole('button', { name: 'Save' });
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

describe('task form layout', () => {
  it('has the name as the first field, before the pipeline', async () => {
    show(queueOf());
    await openNewTask();
    const name = await screen.findByLabelText('Name');
    const pipeline = screen.getByRole('combobox', { name: 'Pipeline' });
    expect(name.compareDocumentPosition(pipeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.id).toBe('new-title');
  });

  it('shows a long task title whole in the list and in the chip', async () => {
    const long = 'Очень длинное название задачи которое не помещается в строку'.slice(0, 60);
    show(queueOf({ items: [{ ...queueItem('q1', 'x', 1), title: long }] }));
    await openNewTask();
    fireEvent.click(screen.getByRole('combobox', { name: 'Waits for' }));
    const option = await screen.findByRole('option', { name: new RegExp(long) });
    expect(option.querySelector(`[title="#1 ${long}"]`)).toBeTruthy();
    fireEvent.click(option);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    const chip = document.querySelector(`span.truncate[title="#1 ${long}"]`);
    expect(chip).toBeTruthy();
  });
});

describe('dependencies in the form', () => {
  it('adds a task after another', async () => {
    const api = show(queueOf({ items: [model()] }));
    await openNewTask();
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'API' } });
    await pick(screen.getByRole('combobox', { name: 'Waits for' }), 'Модель');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        task: 'API',
        after: ['q1'],
      }),
    );
  });

  it('removes all predecessors with an empty list', async () => {
    const api = show(queueOf({ items: [model(), apiItem()] }));
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('API');
    const chip = await screen.findByRole('button', { name: 'Remove #1 Модель' });
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
    await openNewTask();
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
    const picker = await screen.findByRole('combobox', { name: 'Waits for' });
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
    const picker = await screen.findByRole('combobox', { name: 'Waits for' });
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
    fireEvent.click(await screen.findByRole('button', { name: /^Remove (#\d+ )?Модель$/ }));
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
    const picker = await screen.findByRole('combobox', { name: 'Waits for' });
    await pick(picker, 'Модель');
    expect(screen.getAllByRole('button', { name: 'Remove #1 Модель' })).toHaveLength(1);
    act(() => {
      stream().open();
      stream().send({
        event: 'queue',
        seq: 5,
        queue: queueOf({ items: [model(), queueItem('q2', 'api', 2, { title: 'API' })] }),
      });
    });
    expect(screen.getAllByRole('button', { name: 'Remove #1 Модель' })).toHaveLength(1);
  });

  it('shows a cycle error at the form and keeps the choice', async () => {
    const api = show(queueOf({ items: [model(), apiItem()] }), {
      queueEdit: vi.fn(async () => {
        throw new ApiError(400, 'dependency cycle: q1 -> q2 -> q1');
      }),
    });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('Модель');
    const picker = await screen.findByRole('combobox', { name: 'Waits for' });
    await pick(picker, 'API');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('dependency cycle: q1 -> q2 -> q1');
    expect(api.queueEdit).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove #2 API' })).toBeTruthy();
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
    expect(
      [...li.querySelectorAll('[data-state]')].filter(
        (node) => !node.matches('[aria-label^="Pipeline"]') && !node.closest('[data-actions]'),
      ),
    ).toEqual([]);
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
    const controls = await screen.findByRole('region', { name: 'queue controls' });
    expect(controls.parentElement?.parentElement?.className).toContain(
      'lg:grid-cols-[18rem_minmax(0,1fr)]',
    );
    expect(controls.parentElement?.parentElement?.previousElementSibling).toBeNull();
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
    const controls = await screen.findByRole('region', { name: 'queue controls' });
    const runs = screen.getByRole('region', { name: 'running from the queue' });
    expect(controls.compareDocumentPosition(runs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(runs).getByRole('list').className).toContain('grid-cols-1');
  });
});

describe('queue controls block', () => {
  const controlsBlock = async () =>
    within(await screen.findByRole('region', { name: 'queue controls' }));

  it('shows the badge, start, pause, parallelism and the link to the settings', async () => {
    show(queueOf({ items: items('A') }));
    const block = await controlsBlock();
    expect(block.getByText('Stopped')).toBeTruthy();
    expect(
      block
        .getAllByRole('button')
        .map((b) => b.textContent)
        .filter((text) => text !== ''),
    ).toEqual(['New task', 'Start', 'Pause']);
    expect(block.getByLabelText('Parallelism')).toBeTruthy();
    expect(block.getByRole('link', { name: 'Queue settings' }).getAttribute('href')).toBe(
      '#settings/project/queue',
    );
  });

  it('puts the primary «New task» button alone on its row', async () => {
    show(queueOf({ items: items('A') }));
    const block = await controlsBlock();
    const button = block.getByRole('button', { name: 'New task' });
    expect(button.parentElement?.querySelectorAll('button').length).toBe(1);
    expect(button.className).toContain('bg-primary');
    expect(block.getByRole('button', { name: 'Start' }).className).not.toContain('bg-primary');
  });

  it('has none of the modes of the queue', async () => {
    show(queueOf({ items: items('A') }));
    await controlsBlock();
    for (const name of [
      'Keep running when empty',
      'Answer questions',
      'Skip failed',
      'Auto delivery by default',
    ])
      expect(screen.queryByRole('switch', { name })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Delivery mode' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'On a usage limit' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Answer to questions' })).toBeNull();
  });

  it('opens the group Queue of the settings from the link', async () => {
    show(queueOf());
    const block = await controlsBlock();
    fireEvent.click(block.getByRole('link', { name: 'Queue settings' }));
    await waitFor(() => expect(window.location.hash).toBe('#settings/project/queue'));
    const modes = within(await screen.findByRole('region', { name: 'queue settings' }));
    for (const name of [
      'Keep running when empty',
      'Answer questions',
      'Skip failed',
      'Auto delivery by default',
    ])
      expect(modes.getByRole('switch', { name })).toBeTruthy();
    expect(modes.getByRole('combobox', { name: 'Delivery mode' })).toBeTruthy();
    expect(modes.getByRole('combobox', { name: 'On a usage limit' })).toBeTruthy();
  });

  it('shows the running queue after the autopilot is turned on in the settings', async () => {
    const api = show(queueOf({ items: items('A') }), {
      queueSettings: vi.fn(async () =>
        queueOf({
          status: 'running',
          autopilot: true,
          runs: [queueRun('run1', { title: 'Вход' })],
        }),
      ),
    });
    window.location.hash = '#settings/queue';
    fireEvent.click(await screen.findByRole('switch', { name: 'Keep running when empty' }));
    await waitFor(() => expect(api.queueSettings).toHaveBeenCalledWith({ autopilot: true }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'sections' })).getByRole('link', {
        name: 'Queue',
      }),
    );
    await screen.findByRole('region', { name: 'running from the queue' });
    expect((await controlsBlock()).getByText('Running')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Вход' })).toBeTruthy();
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
      formatRoute({ view: 'runs', run: 'run1', group: 'login', step: null, tab: null }),
    );
    const running = screen.getByRole('region', { name: 'running from the queue' });
    expect(within(running).getByRole('heading').textContent).toContain('1 of 1 place');
    expect(within(running).queryByText('Логин')).toBeNull();
  });

  it('offers the return only for a returnable run and removes after the confirmation', async () => {
    const api = show(
      queueOf({
        skipped: [
          queueRun('run1', { title: 'Логин', state: 'failed', returnable: false }),
          queueRun('run2', { title: 'Вход', state: 'failed', returnable: true }),
        ],
      }),
      { queueDismiss: vi.fn(async () => queueOf()) },
    );
    const skipped = within(await screen.findByRole('region', { name: 'skipped with a problem' }));
    const first = within(skipped.getByRole('group', { name: 'Логин' }));
    const second = within(skipped.getByRole('group', { name: 'Вход' }));
    expect(first.queryByRole('button', { name: 'Return to the queue' })).toBeNull();
    expect(second.getByRole('button', { name: 'Return to the queue' })).toBeTruthy();
    fireEvent.click(first.getByRole('button', { name: 'Remove from list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.queueDismiss).not.toHaveBeenCalled();
    fireEvent.click(first.getByRole('button', { name: 'Remove from list' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Remove Логин from the skipped list?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from list' }));
    await waitFor(() => expect(api.queueDismiss).toHaveBeenCalledWith('run1', '/repo'));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'skipped with a problem' })).toBeNull(),
    );
  });

  it('has no block without skipped runs', async () => {
    show(queueOf({ status: 'running' }));
    await screen.findByRole('region', { name: 'queue controls' });
    expect(screen.queryByRole('region', { name: 'skipped with a problem' })).toBeNull();
  });

  it('shows the block of a paused queue without runs', async () => {
    show(queueOf({ skipped: [queueRun('run1', { title: 'Логин', state: 'failed' })] }));
    await screen.findByRole('region', { name: 'skipped with a problem' });
    expect(screen.queryByRole('region', { name: 'running from the queue' })).toBeNull();
  });
});

describe('delivery mode of a task', () => {
  it('sends the chosen mode only when it is chosen and shows it in the list', async () => {
    const api = show(queueOf({ deliveryMode: 'worktree' }), {
      queueAdd: vi.fn(async () => ({ ...queueOf(), item: 'q1' })),
    });
    await openNewTask();
    const text = await screen.findByLabelText('Task text');
    const select = screen
      .getAllByRole('combobox', { name: 'Delivery mode' })
      .find((node) => node.id === 'new-delivery-mode')!;
    expect(select.textContent).toBe('In the working tree');
    expect(screen.getByText('mode as in the settings')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(text, { target: { value: 'Сделать вход' } });
    fireEvent.keyDown(select, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Branch' }));
    expect(screen.getByText('mode for this task')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        task: 'Сделать вход',
        deliveryMode: 'branch',
      }),
    );
  });

  it('marks a task with its own mode and sends null when an edit resets it', async () => {
    const api = show(queueOf({ items: [queueItem('q1', 'A', 1, { deliveryMode: 'commit' })] }));
    expect(await screen.findByText('delivery: Commit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'mode as in the settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith('q1', {
        pipeline: 'feature',
        task: 'A',
        title: null,
        autoDeliver: null,
        deliveryMode: null,
        tags: [],
        skip: [],
      }),
    );
  });
});

describe('row layout', () => {
  it('puts predecessors on a second line with a label and the full name in the title', async () => {
    const long = 'A very long predecessor name that must be cut by the chip';
    const ref = (id: string, number: number, title: string) => ({
      id,
      kind: 'item',
      number,
      title,
      state: 'waiting',
    });
    show(
      queueOf({
        items: [
          queueItem('q2', 'B', 3, { after: [ref('q0', 1, long), ref('q1', 2, 'Short')] } as never),
        ],
      }),
    );
    const row = (await screen.findByRole('listitem')) as HTMLElement;
    const second = row.querySelector('[data-dependencies]') as HTMLElement;
    expect(second).toBeTruthy();
    expect(within(second).getByText('Waits for:')).toBeTruthy();
    expect(second.querySelectorAll('[data-state]')).toHaveLength(2);
    expect(second.querySelector('[data-state]')!.getAttribute('title')).toContain(long);
    const actions = row.querySelector('[data-actions]') as HTMLElement;
    expect(actions.parentElement!.textContent).not.toMatch(/after:/);
    expect(actions.parentElement!.lastElementChild).toBe(actions);
  });

  it('has no second line without predecessors, and the buttons have no text', async () => {
    show(queueOf({ items: [queueItem('q1', 'A', 1)] }));
    const row = (await screen.findByRole('listitem')) as HTMLElement;
    expect(row.querySelector('[data-dependencies]')).toBeNull();
    expect(screen.queryByText('Waits for:')).toBeNull();
    const buttons = [...row.querySelectorAll('[data-actions] button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Edit',
      'Postpone',
      'Run now',
      'Remove',
    ]);
    for (const button of buttons) {
      expect(button.textContent).toBe('');
    }
  });
});

describe('postponed items', () => {
  it('presses the button, shows the badge, and sends only postponed', async () => {
    const after = queueOf({ items: [queueItem('q1', 'A', 1, { postponed: true })] });
    const api = show(queueOf({ items: [queueItem('q1', 'A', 1)] }), {
      queueEdit: vi.fn(async () => after),
    });
    const toggle = await screen.findByRole('button', { name: 'Postpone' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Postponed')).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalledWith('q1', { postponed: true }));
    await screen.findByText('Postponed');
    expect(screen.getByRole('button', { name: 'Postpone' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('puts the button back and shows the error when the request fails', async () => {
    show(queueOf({ items: [queueItem('q1', 'A', 1)] }), {
      queueEdit: vi.fn(async () => {
        throw new ApiError(500, 'boom');
      }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Postpone' }));
    await screen.findAllByText('boom');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Postpone' }).getAttribute('aria-pressed')).toBe(
        'false',
      ),
    );
    expect(screen.queryByText('Postponed')).toBeNull();
  });

  async function fillNewTask(text = 'X') {
    await openNewTask();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(await screen.findByLabelText('Task text'), { target: { value: text } });
  }

  it('adds a task without postponed while the new-task switch is off', async () => {
    const api = show(queueOf());
    await fillNewTask();
    expect(screen.getByRole('switch', { name: 'Postpone' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect((api.queueAdd as ReturnType<typeof vi.fn>).mock.calls[0]![0]).not.toHaveProperty(
      'postponed',
    );
  });

  it('adds a postponed task when the new-task switch is on', async () => {
    const api = show(queueOf(), {
      queueAdd: vi.fn(async () => ({
        ...queueOf({ items: [queueItem('q1', 'X', 1, { postponed: true })] }),
        item: 'q1',
      })),
    });
    await fillNewTask();
    fireEvent.click(screen.getByRole('switch', { name: 'Postpone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        task: 'X',
        postponed: true,
      }),
    );
    await screen.findByText('Postponed');
  });

  it('does not send postponed after the switch is turned on and off', async () => {
    const api = show(queueOf());
    await fillNewTask();
    const toggle = screen.getByRole('switch', { name: 'Postpone' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalled());
    expect((api.queueAdd as ReturnType<typeof vi.fn>).mock.calls[0]![0]).not.toHaveProperty(
      'postponed',
    );
  });

  it('keeps the switch in the draft after Escape and resets it after adding', async () => {
    show(queueOf(), {
      queueAdd: vi.fn(async () => ({ ...queueOf({ items: items('X') }), item: 'q1' })),
    });
    await fillNewTask();
    fireEvent.click(screen.getByRole('switch', { name: 'Postpone' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    await openNewTask();
    expect(screen.getByRole('switch', { name: 'Postpone' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    await openNewTask();
    expect(screen.getByRole('switch', { name: 'Postpone' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('keeps the switch and shows the error when the queue refuses the task', async () => {
    show(queueOf(), {
      queueAdd: vi.fn(async () => {
        throw new ApiError(400, 'unknown pipeline');
      }),
    });
    await fillNewTask();
    fireEvent.click(screen.getByRole('switch', { name: 'Postpone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/unknown pipeline/);
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Postpone' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('has no switch in the edit form', async () => {
    show(queueOf({ items: [queueItem('q1', 'A', 1)] }));
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('button', { name: 'Save' });
    expect(screen.queryByRole('switch', { name: 'Postpone' })).toBeNull();
  });

  it('does not send postponed when the form is saved', async () => {
    const api = show(queueOf({ items: [queueItem('q1', 'A', 1, { postponed: true })] }));
    await screen.findByText('Postponed');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalled());
    expect((api.queueEdit as ReturnType<typeof vi.fn>).mock.calls[0]![1]).not.toHaveProperty(
      'postponed',
    );
  });
});

describe('system stages and waiting in the cards of the queue', () => {
  const card = (overrides = {}) =>
    show(
      queueOf({
        status: 'running',
        runs: [queueRun('run1', { title: 'Вход', ...overrides })],
      }),
    );

  it('shows a group that waits for a specialist with the reason', async () => {
    card({
      waiting: [
        {
          group: 'signup',
          step: 'code',
          wait: { reason: 'specialist', specialist: 'coder', name: 'Coder', max: 1 },
        },
      ],
    });
    expect(await screen.findByText('signup')).toBeTruthy();
    expect(screen.getByText('Waiting for Coder: 1 of 1 busy')).toBeTruthy();
  });

  it('shows the commit message step as active and the system stages row', async () => {
    card({
      active: [{ group: '_message', step: 'message' }],
      system: [
        { kind: 'split', status: 'done' },
        { kind: 'message', status: 'running' },
      ],
      delivery: 'pending',
    });
    const row = await screen.findByLabelText('System stages');
    expect(within(row).getByText('Split into groups')).toBeTruthy();
    expect(within(row).getByText('Commit message')).toBeTruthy();
    expect(within(row).getByText('Delivery')).toBeTruthy();
  });

  it('shows a failed delivery of the run', async () => {
    card({ delivery: 'apply_failed' });
    const row = await screen.findByLabelText('System stages');
    expect(within(row).getByText('Delivery failed')).toBeTruthy();
  });

  it('keeps the splitting text while there are no groups', async () => {
    card({ groups: { done: 0, total: 0 }, system: [{ kind: 'split', status: 'running' }] });
    expect(await screen.findByText('splitting the task')).toBeTruthy();
  });
});

const STEP_NAMES: Record<string, string> = {
  plan: 'Планировщик',
  code: 'Кодер',
  review: 'Ревьюер',
  qa: 'Тестировщик',
  deliver: 'Доставщик',
};
const stepOf = (id: string) => ({ ...pipelineOf().steps[0]!, id, name: STEP_NAMES[id] ?? id });
const skipGroup = () => screen.getByText('Skip steps', { selector: 'legend' }).parentElement!;
/** The segment of a step by its id; it is labelled with the name of the step. */
const skipStep = (id: string) =>
  within(skipGroup()).getByRole<HTMLButtonElement>('button', { name: STEP_NAMES[id] ?? id });
const skipStepAsync = async (name: string) => {
  await waitFor(() => skipStep(name));
  return skipStep(name);
};

const fiveSteps = pipelinesView({
  pipelines: [
    pipelineOf({ steps: ['plan', 'code', 'review', 'qa', 'deliver'].map(stepOf) }),
    pipelineOf({ id: 'small', steps: ['code', 'review'].map(stepOf) }),
  ],
});

describe('new task dialog', () => {
  it('has one button inside the controls before Start and no form before it is opened', async () => {
    show(queueOf());
    const controls = await screen.findByRole('region', { name: 'queue controls' });
    const button = within(controls).getByRole('button', { name: 'New task' });
    expect(within(controls).getAllByRole('button', { name: 'New task' })).toHaveLength(1);
    expect(controls.contains(button)).toBe(true);
    expect(
      button.compareDocumentPosition(within(controls).getByRole('button', { name: 'Start' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByLabelText('Task text')).toBeNull();
  });

  it('opens a large dialog with the focus in the task field', async () => {
    show(queueOf());
    const dialog = await openNewTask();
    expect(dialog.className).toContain('md:max-h-[90vh]');
    expect(dialog.className).not.toContain('md:h-[75vh]');
    expect(dialog.className.split(' ')).not.toContain('h-[calc(100dvh-2rem)]');
    expect(dialog.className).toContain('md:w-[75vw]');
    expect(dialog.className).toContain('content-start');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Task text')));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Task text').rows).toBe(9);
    expect(screen.getByLabelText('Task text').id).toBe('new-task');
  });

  it('focuses the title of the first group in the groups mode', async () => {
    show(queueOf());
    await openNewTask();
    fireEvent.click(screen.getByRole('radio', { name: 'Groups' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openNewTask();
    await waitFor(() => expect(document.activeElement?.id).toBe('new-group-0-title'));
  });

  it('closes after the task is added and stays open on an error', async () => {
    const queueAdd = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(400, 'unknown pipeline `feature`; known: none'))
      .mockResolvedValueOnce({ ...queueOf({ items: items('X') }), item: 'q1' });
    show(queueOf(), { queueAdd });
    await openNewTask();
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'X' } });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/unknown pipeline/);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the draft after Esc and does not close on events', async () => {
    show(queueOf());
    await openNewTask();
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'черновик' } });
    act(() => {
      stream().open();
      stream().send({ event: 'queue', seq: 5, queue: queueOf() });
      stream().send({ event: 'run', seq: 6, run: runView() });
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openNewTask();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Task text').value).toBe('черновик');
  });
});

describe('two halves of the task form', () => {
  it('puts the task half first in the DOM and on a wide form', async () => {
    show(queueOf(), { pipelines: vi.fn(async () => fiveSteps) });
    const dialog = await openNewTask();
    await skipStepAsync('plan');
    const order = [
      screen.getByLabelText('Name'),
      screen.getByRole('combobox', { name: 'Pipeline' }),
      screen.getByLabelText('Task text'),
      screen.getByRole('combobox', { name: 'Waits for' }),
      screen.getByRole('combobox', { name: 'Tags' }),
      screen.getByRole('switch', { name: 'Postpone' }),
      screen.getByRole('switch', { name: 'Auto delivery' }),
      screen.getByRole('combobox', { name: 'Delivery mode' }),
      screen.getByText('Skip steps'),
      screen.getByRole('button', { name: 'Add' }),
    ];
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    const grid = screen.getByLabelText('Task text').closest('.\\@3xl\\:grid-cols-2')!;
    expect(grid).toBeTruthy();
    expect(grid.className).not.toMatch(/(^| )(@3xl:)?order-/);
    expect(dialog.querySelector('.\\@3xl\\:order-first')).toBeNull();
    expect(grid.children[0]!.contains(order[2]!)).toBe(true);
    expect(grid.children[1]!.contains(order[3]!)).toBe(true);
  });

  it('offers a segment for every step in order', async () => {
    show(queueOf(), { pipelines: vi.fn(async () => fiveSteps) });
    await openNewTask();
    await skipStepAsync('plan');
    expect(
      within(skipGroup())
        .getAllByRole('button')
        .map((box) => box.id),
    ).toEqual(['plan', 'code', 'review', 'qa', 'deliver'].map((step) => `new-skip-${step}`));
  });

  it('does not let the last step be skipped', async () => {
    show(queueOf(), { pipelines: vi.fn(async () => fiveSteps) });
    await openNewTask();
    for (const step of ['plan', 'code', 'review', 'qa']) fireEvent.click(await skipStepAsync(step));
    expect(skipStep('deliver').disabled).toBe(true);
    expect(skipStep('plan').disabled).toBe(false);
  });

  it('sends the skipped steps on create', async () => {
    const api = show(queueOf(), { pipelines: vi.fn(async () => fiveSteps) });
    await openNewTask();
    fireEvent.click(await skipStepAsync('review'));
    fireEvent.click(skipStep('qa'));
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        task: 'T',
        skip: ['review', 'qa'],
      }),
    );
  });

  it('drops marks the new pipeline does not have', async () => {
    const api = show(queueOf(), { pipelines: vi.fn(async () => fiveSteps) });
    await openNewTask();
    fireEvent.click(await skipStepAsync('qa'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Pipeline' }));
    fireEvent.click(await screen.findByRole('option', { name: 'small' }));
    await waitFor(() => expect(within(skipGroup()).getAllByRole('button')).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({ pipeline: 'small', task: 'T' }),
    );
  });

  describe('variants of the pipeline', () => {
    const withVariants = pipelinesView({
      pipelines: [
        pipelineOf({
          steps: ['plan', 'code', 'review', 'qa', 'deliver'].map(stepOf),
          variants: [
            variantOf(['plan', 'code', 'review', 'qa', 'deliver'].map(stepOf), 'default'),
            variantOf(['plan', 'code', 'review', 'qa', 'deliver'].map(stepOf), 'light', 'Лёгкий', [
              'review',
              'qa',
            ]),
          ],
        }),
        pipelineOf({ id: 'small', steps: ['code', 'review'].map(stepOf) }),
      ],
    });

    it('chooses a variant, sends it and shows its steps pressed and locked', async () => {
      const api = show(queueOf(), { pipelines: vi.fn(async () => withVariants) });
      await openNewTask();
      await skipStepAsync('plan');
      fireEvent.click(screen.getByRole('combobox', { name: 'Variant' }));
      fireEvent.click(await screen.findByRole('option', { name: 'Лёгкий' }));
      await waitFor(() => expect(skipStep('review').disabled).toBe(true));
      expect(skipStep('review').getAttribute('aria-pressed')).toBe('true');
      expect(skipStep('qa').getAttribute('aria-pressed')).toBe('true');
      expect(skipStep('plan').getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(skipStep('plan'));
      fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'T' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      // the task keeps only its own skip: the steps of the variant are not in it
      await waitFor(() =>
        expect(api.queueAdd).toHaveBeenCalledWith({
          pipeline: 'feature',
          variant: 'light',
          task: 'T',
          skip: ['plan'],
        }),
      );
    });

    it('resets the variant when the pipeline changes and has no field without variants', async () => {
      show(queueOf(), { pipelines: vi.fn(async () => withVariants) });
      await openNewTask();
      await skipStepAsync('plan');
      fireEvent.click(screen.getByRole('combobox', { name: 'Variant' }));
      fireEvent.click(await screen.findByRole('option', { name: 'Лёгкий' }));
      fireEvent.click(screen.getByRole('combobox', { name: 'Pipeline' }));
      fireEvent.click(await screen.findByRole('option', { name: 'small' }));
      await waitFor(() => expect(within(skipGroup()).getAllByRole('button')).toHaveLength(2));
      expect(screen.queryByRole('combobox', { name: 'Variant' })).toBeNull();
      expect(skipStep('review').disabled).toBe(false);
    });
  });

  it('shows the skipped steps of an item and edits them', async () => {
    const api = show(
      queueOf({
        items: [queueItem('q1', 'A', 1, { skip: ['review', 'qa'] }), queueItem('q2', 'B', 2)],
      }),
      { pipelines: vi.fn(async () => fiveSteps) },
    );
    await screen.findByLabelText('skips: Ревьюер, Тестировщик');
    expect(screen.getAllByLabelText(/^skips:/)).toHaveLength(1);
    expect(screen.queryByText(/^skips:/)).toBeNull();
    fireEvent.click(
      within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }),
    );
    const review = await skipStepAsync('review');
    expect(review.getAttribute('aria-pressed')).toBe('true');
    expect(skipStep('qa').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(review);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith('q1', expect.objectContaining({ skip: ['qa'] })),
    );
  });

  it('clears the skip of an item with an empty list', async () => {
    const api = show(queueOf({ items: [queueItem('q1', 'A', 1, { skip: ['review'] })] }), {
      pipelines: vi.fn(async () => fiveSteps),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await skipStepAsync('review'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith('q1', expect.objectContaining({ skip: [] })),
    );
  });
});

describe('skip in the draft', () => {
  it('sends skip on create only when it is not empty and always on edit', () => {
    const draft = emptyDraft('feature');
    draft.task = 'T';
    expect('skip' in fieldsOf(draft)).toBe(false);
    expect(fieldsOf(draft, undefined, true).skip).toEqual([]);
    expect(fieldsOf({ ...draft, skip: ['qa'] }).skip).toEqual(['qa']);
  });

  it('copies the skip of an item into its draft', () => {
    const item = queueItem('q1', 'A', 1, { skip: ['qa'] });
    const draft = draftOf(item);
    expect(draft.skip).toEqual(['qa']);
    expect(draft.skip).not.toBe(item.skip);
    expect(draftOf(queueItem('q2', 'B', 2)).skip).toEqual([]);
  });

  it('prunes marks to the steps in their order', () => {
    expect(pruneSkip(['qa', 'plan', 'x'], ['plan', 'code', 'qa'])).toEqual(['plan', 'qa']);
    expect(pruneSkip(['qa'], [])).toEqual([]);
  });
});

describe('parent task in the form', () => {
  const linked = {
    id: 'tl',
    repository: '/repo',
    name: 'parent-run',
    color: 'indigo' as const,
    task: { run: 'run1', number: 12 },
  };
  const choose = async (name: string) => {
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent task' }));
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
  };
  const parentQueue = (items = [apiItem()]) =>
    queueOf({ items, runs: [queueRun('run1', { title: 'Parent', number: 12 })] });
  /** The runs the panel knows, as the first snapshot of the stream brings them. */
  const sendRuns = async (...runs: Parameters<typeof runView>[0][]) => {
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    act(() => {
      stream().send({ event: 'snapshot', seq: 1, runs: runs.map((run) => runView(run)) });
    });
  };
  const parent = () => sendRuns({ id: 'run1', title: 'Parent', number: 12 });

  it('adds a task with the parent chosen from the runs', async () => {
    const api = show(parentQueue([]));
    await parent();
    await openNewTask();
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'Next' } });
    await choose('Parent');
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        task: 'Next',
        parent: 'run1',
      }),
    );
  });

  it('does not send the parent of an edit when the field was not touched', async () => {
    const item = queueItem('q1', 'API', 1, { tags: [linked] });
    const api = show(parentQueue([item]));
    await parent();
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('API');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Parent task' }).textContent).toContain('Parent'),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.queueEdit).toHaveBeenCalled());
    expect(vi.mocked(api.queueEdit).mock.calls[0]![1]).not.toHaveProperty('parent');
  });

  it('sends null when the parent is cleared in an edit', async () => {
    const item = queueItem('q1', 'API', 1, { tags: [linked] });
    const api = show(parentQueue([item]));
    await parent();
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('API');
    await choose('No parent task');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith('q1', expect.objectContaining({ parent: null })),
    );
  });

  it('offers a finished run as the parent of a new task, after the active and planned ones', async () => {
    const api = show(queueOf());
    await sendRuns(
      {
        id: 'old',
        title: 'Old',
        number: 3,
        finished: true,
        state: 'finished',
        finishedAt: 5_000,
      },
      {
        id: 'new',
        title: 'Recent',
        number: 4,
        finished: true,
        state: 'finished',
        finishedAt: 9_000,
      },
      {
        id: 'plan',
        title: 'Planned',
        number: 6,
        startedAt: null,
        state: 'queued',
        createdAt: 100,
      },
      { id: 'work', title: 'Working', number: 5 },
      { id: 'other', title: 'Elsewhere', number: 9, repository: '/b' },
    );
    await openNewTask();
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'Next' } });
    await screen.findByRole('combobox', { name: 'Parent task' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent task' }));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(options).toEqual(['No parent task', '#5 Working', '#6 Planned', '#4 Recent', '#3 Old']);
    for (const label of ['In progress', 'Planned', 'Finished'])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('option', { name: '#4 Recent' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        task: 'Next',
        parent: 'new',
      }),
    );
  });

  it('shows a finished parent of an item as #N title in the edit form', async () => {
    const item = queueItem('q1', 'API', 1, { tags: [linked] });
    show(queueOf({ items: [item] }));
    await sendRuns({
      id: 'run1',
      title: 'Вход по ссылке',
      number: 12,
      finished: true,
      state: 'finished',
    });
    await screen.findByRole('list', { name: 'tasks in the queue' });
    await editRow('API');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Parent task' }).textContent).toBe(
        '#12 Вход по ссылке',
      ),
    );
  });
});

describe('parentChoices', () => {
  const run = (id: string, overrides: Parameters<typeof runView>[0] = {}) =>
    runView({ id, number: Number(id.replace(/\D/g, '')) || 1, title: id, ...overrides });

  it('orders in progress, planned and finished runs of the repository', () => {
    const runs = [
      run('f1', { finished: true, state: 'finished', finishedAt: 10 }),
      run('f2', { finished: true, state: 'cancelled', finishedAt: 20 }),
      run('p1', { startedAt: null, state: 'queued', createdAt: 5 }),
      run('p2', { state: 'queued', createdAt: 8 }),
      run('a1', { startedAt: 100 }),
      run('a2', { startedAt: 200, state: 'paused', hold: 'paused' }),
      run('x1', { repository: '/b' }),
    ];
    const choices = parentChoices(runs, '/repo');
    expect(choices.map((choice) => [choice.id, choice.section])).toEqual([
      ['a2', 'active'],
      ['a1', 'active'],
      ['p2', 'planned'],
      ['p1', 'planned'],
      ['f2', 'finished'],
      ['f1', 'finished'],
    ]);
    expect(parentChoices(runs, '/b').map((choice) => choice.id)).toEqual(['x1']);
  });
});
