// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { TagsProvider } from '../src/tags.tsx';
import { RunList } from '../src/components/runs/RunList.tsx';
import { cleanup, render, screen, within } from './render.tsx';
import { runView, tagView } from './fixtures.ts';

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
        filter="all"
        onFilter={() => undefined}
        onSelect={() => undefined}
        scope="repository"
        onScope={() => undefined}
        repository="/repo"
        tagIds={[]}
        onTagIds={() => undefined}
        {...props}
      />
    </TagsProvider>,
  );
  return screen.getByRole('button', { name: /./ });
}

const full = () =>
  runView({
    number: 7,
    title: 'форма входа',
    name: 'login-form',
    tags: [tagView('auth')],
    progress: { done: 2, total: 4 },
    usage: { inputTokens: 12_300, outputTokens: 1_100, costUsd: 0.42 },
    diff: { files: 2, added: 367, removed: 0 },
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
    const row = show(runView({ name: null, diff: null, progress: { done: 0, total: 4 } }));
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(within(row).getByRole('progressbar').textContent).toBe('0%');
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
});
