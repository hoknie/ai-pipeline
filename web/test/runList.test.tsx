// @vitest-environment jsdom
import { EMPTY_FILTERS } from '../src/components/runs/runFilter.ts';
import i18next from 'i18next';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { TagsProvider } from '../src/tags.tsx';
import { RunList } from '../src/components/runs/RunList.tsx';
import { cleanup, fireEvent, render, screen, within } from './render.tsx';
import { groupRow, runView, tagView } from './fixtures.ts';

afterEach(cleanup);

type Props = Partial<Omit<Parameters<typeof RunList>[0], 'runs'>>;

function show(run: ReturnType<typeof runView>, props: Props = {}) {
  render(
    <TagsProvider tags={[tagView('auth')]}>
      <RunList
        runs={[run]}
        selectedRun={null}
        selectedGroup={null}
        now={2_000}
        query=""
        onQuery={() => undefined}
        filters={EMPTY_FILTERS}
        onFilters={() => undefined}
        onSelect={() => undefined}
        scope="repository"
        onScope={() => undefined}
        repository="/repo"
        {...props}
      />
    </TagsProvider>,
  );
  return screen.getAllByRole('button', { name: /./ })[0]!;
}

const full = () =>
  runView({
    number: 7,
    title: 'форма входа',
    name: 'login-form',
    tags: [tagView('auth')],
    progress: { done: 2, total: 4 },
    usage: { inputTokens: 12_300, outputTokens: 1_100, costUsd: 0.42 },
    diff: null,
    liveDiff: { files: 2, added: 367, removed: 0 },
  });

describe('run row layout', () => {
  it('shows the lines in order', () => {
    const row = show(full());
    const text = row.textContent!;
    const order = ['#7', 'login-form', 'feature', 'auth', '50%', '12.3k/1.1k', '$0.42', '+367 −0'];
    const at = order.map((part) => text.indexOf(part));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const bar = within(row).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.textContent).toBe('50%');
  });

  it('shows dashes without a name and without a diff', () => {
    const row = show(
      runView({ name: null, diff: null, liveDiff: null, progress: { done: 0, total: 4 } }),
    );
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(within(row).getByRole('progressbar').textContent).toBe('0%');
  });

  it('shows the live diff before any group is merged', () => {
    const row = show({
      ...full(),
      diff: null,
      liveDiff: { files: 2, added: 367, removed: 0 },
    });
    expect(row.textContent).toContain('2 files +367 −0');
  });

  it('wraps the full title and keeps it in the tooltip', () => {
    const title = 'очень длинное название запуска '.repeat(8).trim();
    const row = show(runView({ title }));
    const first = row.querySelector('span')!;
    expect(first.className).not.toContain('truncate');
    expect(first.textContent).toContain(title);
    expect(first.textContent).not.toContain('…');
    expect(row.getAttribute('title')).toContain(title);
  });

  it('shows 0% while the task is split', () => {
    const row = show(runView({ progress: { done: 0, total: 0 } }));
    expect(within(row).getByRole('progressbar').textContent).toBe('0%');
  });

  it('colours the fill by the percentage', () => {
    const row = show(runView({ progress: { done: 4, total: 4 } }));
    const fill = row.querySelector<HTMLElement>('[data-fill]')!;
    expect(fill.style.width).toBe('100%');
    expect(fill.getAttribute('style')).toContain('--color-status-ok) 100%');
  });

  it('shows the repository only for all repositories', () => {
    show(runView({ repository: '/work/myrepo' }), { scope: 'all' });
    expect(screen.getByText('myrepo')).toBeTruthy();
    cleanup();
    show(runView({ repository: '/work/myrepo' }), { repository: '/work/myrepo' });
    expect(screen.queryByText('myrepo')).toBeNull();
  });

  it('keeps the bar in the second grid column whatever the status', () => {
    const row = show(runView({ state: 'needs_human' as never, waiting: 2 }));
    const bar = within(row).getByRole('progressbar');
    const grid = bar.parentElement!;
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.lastElementChild).toBe(bar);
  });

  it('has no bar for a finished run, but keeps the badge and the grid cell', () => {
    const row = show(
      runView({ state: 'finished', finished: true, progress: { done: 4, total: 4 } }),
    );
    expect(within(row).queryByRole('progressbar')).toBeNull();
    expect(row.textContent).not.toContain('100%');
    expect(within(row).getByLabelText(/\(finished\)$/)).toBeTruthy();
    expect(row.querySelector('.grid-cols-2')).toBeTruthy();
  });

  it('keeps the bar of a failed run', () => {
    const row = show(runView({ state: 'failed', progress: { done: 2, total: 4 } }));
    expect(within(row).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  });

  it('shows the bar again when the run returns to work', () => {
    const done = runView({ state: 'finished', finished: true, progress: { done: 4, total: 4 } });
    const props = {
      selectedRun: null,
      selectedGroup: null,
      now: 2_000,
      query: '',
      onQuery: () => undefined,
      filters: EMPTY_FILTERS,
      onFilters: () => undefined,
      onSelect: () => undefined,
      scope: 'repository' as const,
      onScope: () => undefined,
      repository: '/repo',
    };
    const { rerender } = render(<RunList runs={[done]} {...props} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    rerender(<RunList runs={[{ ...done, state: 'active', finished: false }]} {...props} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });
});

describe('accepted answers on the card', () => {
  const decisions = [
    { group: 'login', stepId: 'plan', question: 'Формат?', answer: 'JSON', by: 'human' as const },
    { group: 'login', stepId: 'code', question: 'Дальше?', answer: 'Да', by: 'autopilot' as const },
    { group: 'api', stepId: 'code', question: 'Ещё?', answer: 'Нет', by: 'autopilot' as const },
  ];

  it('counts answers by author and lists them in the title', () => {
    const row = show(runView({ decisions }));
    const line = within(row).getByText(/Answers/);
    expect(line.textContent).toBe('Answers: human 1 · autopilot 2');
    expect(line.getAttribute('title')).toBe(
      [
        'login · plan (human): Формат? → JSON',
        'login · code (autopilot): Дальше? → Да',
        'api · code (autopilot): Ещё? → Нет',
      ].join('\n'),
    );
  });

  it('hides the author without answers', () => {
    const row = show(runView({ decisions: decisions.slice(1) }));
    expect(within(row).getByText(/Answers/).textContent).toBe('Answers: autopilot 2');
    expect(row.textContent).not.toContain('human');
  });

  it('shows no line without answers', () => {
    const row = show(runView({ decisions: [] }));
    expect(row.textContent).not.toContain('Answers');
  });

  it('is translated', async () => {
    await act(() => i18next.changeLanguage('ru'));
    const row = show(runView({ decisions: decisions.slice(0, 1) }));
    expect(within(row).getByText(/Ответы/).textContent).toBe('Ответы: человек 1');
  });
});

describe('groups of a held run in the list', () => {
  const held = (groups: ReturnType<typeof groupRow>[]) =>
    runView({ state: 'frozen', hold: 'frozen', clockStoppedAt: 1_500, groups });

  it('labels a queued group as frozen and a running one as finishing its step', () => {
    show(
      held([
        groupRow({ slug: 'a', title: 'A', status: 'frozen', hold: 'frozen' }),
        groupRow({ slug: 'b', title: 'B', status: 'running', hold: 'frozen' }),
      ]),
      { selectedRun: 'run1' },
    );
    const list = screen.getByRole('list', { name: 'run groups' });
    expect(within(list).getByLabelText('Frozen (frozen)')).toBeTruthy();
    expect(within(list).getByLabelText('Finishing step (running)')).toBeTruthy();
  });

  it('shows the same duration whatever the time is now', () => {
    const run = held([groupRow()]);
    const first = show(run, { now: 5_000 }).textContent;
    cleanup();
    const second = show(run, { now: 600_000 }).textContent;
    expect(second).toBe(first);
  });
});

describe('undelivered result in the list', () => {
  const delivery = (over: Partial<ReturnType<typeof runView>['delivery']> = {}) => ({
    applied: 0,
    merged: 2,
    failed: 0,
    inProgress: false,
    finishedAt: null,
    ...over,
  });
  const stopped = (over: Partial<ReturnType<typeof runView>> = {}) =>
    runView({
      state: 'finished',
      finished: true,
      delivery: delivery(),
      groups: [
        groupRow({ slug: 'a', status: 'merged', delivery: 'pending' }),
        groupRow({ slug: 'b', status: 'merged', delivery: 'applied' }),
      ],
      ...over,
    });

  it('marks the run with a label, a tooltip text and a tint', async () => {
    const row = show(stopped({ delivery: delivery({ applied: 1 }) }));
    const badge = within(row).getByLabelText('Not delivered (undelivered)');
    fireEvent.focus(badge);
    expect((await screen.findByRole('tooltip')).textContent).toContain('1 of 2 groups delivered');
    expect(row.hasAttribute('data-undelivered')).toBe(true);
    expect(row.className).toContain('border-status-warn/40');
    expect(row.className).toContain('bg-status-warn-bg/40');
  });

  it('puts the label after the state and warnings badges', () => {
    const row = show(stopped({ groups: [groupRow({ status: 'merged', warnings: 2 })] }));
    const text = row.textContent!;
    const at = ['Finished', 'Warnings: 2', 'Not delivered'].map((part) => text.indexOf(part));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('shows a failed delivery with its count in any state', async () => {
    const row = show(
      runView({
        state: 'active',
        delivery: delivery({ failed: 1 }),
        deliveryStage: { status: 'apply_failed', reason: 'boom', groups: ['a'] },
      }),
    );
    expect(row.textContent).toContain('Delivery failed 1');
    fireEvent.focus(within(row).getByLabelText(/^Delivery failed 1/));
    expect((await screen.findByRole('tooltip')).textContent).toContain('boom');
    expect(row.hasAttribute('data-undelivered')).toBe(true);
  });

  it('has no mark when everything is delivered', () => {
    const row = show(
      stopped({
        delivery: delivery({ applied: 2 }),
        groups: [groupRow({ status: 'merged', delivery: 'applied' })],
      }),
    );
    expect(row.hasAttribute('data-undelivered')).toBe(false);
    expect(row.textContent).not.toContain('Not delivered');
    expect(row.className).not.toContain('border-status-warn');
  });

  it('keeps the selected border and the label on the selected run', () => {
    const row = show(stopped(), { selectedRun: 'run1' });
    expect(row.className).toContain('border-primary');
    expect(row.classList.contains('bg-accent')).toBe(true);
    expect(row.classList.contains('border-status-warn/40')).toBe(false);
    expect(row.classList.contains('bg-status-warn-bg/40')).toBe(false);
    expect(row.textContent).toContain('Not delivered');
  });

  it('drops the mark when the delivery finishes or starts, without a remount', () => {
    const props = {
      selectedRun: null,
      selectedGroup: null,
      now: 2_000,
      query: '',
      onQuery: () => undefined,
      filters: EMPTY_FILTERS,
      onFilters: () => undefined,
      onSelect: () => undefined,
      scope: 'repository' as const,
      onScope: () => undefined,
      repository: '/repo',
    };
    const view = render(<RunList runs={[stopped()]} {...props} />);
    const row = () => view.container.querySelector('[data-run] button')!;
    expect(row().hasAttribute('data-undelivered')).toBe(true);
    const element = row();
    view.rerender(
      <RunList runs={[stopped({ delivery: delivery({ inProgress: true }) })]} {...props} />,
    );
    expect(row().hasAttribute('data-undelivered')).toBe(false);
    view.rerender(
      <RunList
        runs={[
          stopped({
            delivery: delivery({ applied: 2 }),
            groups: [groupRow({ status: 'merged', delivery: 'applied' })],
          }),
        ]}
        {...props}
      />,
    );
    expect(row()).toBe(element);
    expect(row().textContent).not.toContain('Not delivered');
  });
});
