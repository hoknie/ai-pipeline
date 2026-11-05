// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunStatuses } from '../src/components/runs/RunStatuses.tsx';
import { cleanup, fireEvent, render, screen } from './render.tsx';
import { groupRow, runView } from './fixtures.ts';

afterEach(cleanup);

const labels = () =>
  Array.from(document.querySelectorAll('[aria-label$=")"]')).map((node) =>
    node.getAttribute('aria-label'),
  );

const parts = () =>
  Array.from(document.querySelectorAll('[data-part]')).map((node) =>
    node.textContent?.replace(/:$/, ''),
  );

describe('run statuses', () => {
  it('shows the run, the delivery and the merged group of a delivered run once', () => {
    const group = groupRow({ status: 'merged', delivery: 'applied' });
    const run = runView({
      state: 'finished',
      finished: true,
      groups: [group],
      delivery: { applied: 1, merged: 1, failed: 0, inProgress: false, finishedAt: null },
    });
    render(<RunStatuses run={run} entry={group} />);
    expect(labels()).toEqual([
      expect.stringMatching(/\(finished\)$/),
      'Merged (merged)',
      'Delivered (applied)',
    ]);
    expect(parts()).toEqual(['Run', 'Group', 'Delivery']);
  });

  it('adds the delivery of the open group when several groups are merged', () => {
    const groups = [
      groupRow({ slug: 'a', status: 'merged', delivery: 'applied' }),
      groupRow({ slug: 'b', status: 'merged', delivery: 'pending' }),
    ];
    const run = runView({
      groups,
      delivery: { applied: 1, merged: 2, failed: 0, inProgress: false, finishedAt: null },
    });
    render(<RunStatuses run={run} entry={groups[1]!} />);
    expect(labels()).toEqual([
      expect.stringMatching(/\(active\)$/),
      'Merged (merged)',
      'delivery 1/2 (pending)',
      'Pending (pending)',
    ]);
  });

  it('shows how many groups are merged', () => {
    const groups = [
      groupRow({ slug: 'a', status: 'merged' }),
      groupRow({ slug: 'b', status: 'running' }),
      groupRow({ slug: 'c', status: 'queued' }),
    ];
    const run = runView({ groups });
    render(<RunStatuses run={run} entry={groups[1]!} />);
    expect(labels()).toEqual([
      expect.stringMatching(/\(active\)$/),
      'Running (running)',
      'Merged 1/3 (merged)',
    ]);
    expect(parts()).toEqual(['Run', 'Group']);
  });

  it('keeps the merge as its own part for an open system step', () => {
    const groups = [groupRow({ slug: 'a', status: 'merged' }), groupRow({ slug: 'b' })];
    const step = { ...groupRow({ status: 'running' }), kind: 'split' as const };
    render(<RunStatuses run={runView({ groups })} entry={step} />);
    expect(parts()).toEqual(['Run', 'Step', 'Merge']);
    expect(labels()).toContain('Merged 1/2 (merged)');
  });

  it('keeps the merge as its own part when nothing is open', () => {
    const groups = [groupRow({ status: 'running' })];
    render(<RunStatuses run={runView({ groups })} entry={null} />);
    expect(parts()).toEqual(['Run', 'Merge']);
  });

  it('says not merged and has no delivery part while nothing is merged', () => {
    const groups = [groupRow({ status: 'running' })];
    render(<RunStatuses run={runView({ groups })} entry={groups[0]!} />);
    expect(labels()).toContain('Not merged (not_merged)');
    expect(parts()).toEqual(['Run', 'Group']);
  });

  it('has no merge and delivery parts while the task is split', () => {
    const split = {
      ...groupRow({ status: 'running' }),
      kind: 'split' as const,
    };
    render(<RunStatuses run={runView({ groups: [] })} entry={split} />);
    expect(parts()).toEqual(['Run', 'Step']);
  });

  it('labels a running group of a held run as finishing its step', () => {
    const group = groupRow({ status: 'running', hold: 'frozen' });
    render(
      <RunStatuses
        run={runView({ state: 'frozen', hold: 'frozen', groups: [group] })}
        entry={group}
      />,
    );
    expect(labels()).toContain('Finishing step (running)');
    expect(screen.queryByLabelText('Running (running)')).toBeNull();
  });

  it('keeps a running group without the hold field as running', () => {
    const { hold: _hold, ...legacy } = groupRow({ status: 'running' });
    const entry = legacy as ReturnType<typeof groupRow>;
    render(<RunStatuses run={runView({ groups: [] })} entry={entry} />);
    expect(labels()).toContain('Running (running)');
    expect(screen.queryByLabelText('Finishing step (running)')).toBeNull();
  });

  it('shows a queued group of a held run as frozen', () => {
    const group = groupRow({ status: 'frozen', hold: 'frozen' });
    render(
      <RunStatuses
        run={runView({ state: 'frozen', hold: 'frozen', groups: [group] })}
        entry={group}
      />,
    );
    expect(labels()).toContain('Frozen (frozen)');
  });

  it('puts the parts in one line in the inline layout', () => {
    const group = groupRow({ status: 'running' });
    render(<RunStatuses run={runView({ groups: [group] })} entry={group} layout="inline" />);
    expect(screen.getByText('Run:')).toBeTruthy();
    expect(screen.getByText('Group:')).toBeTruthy();
    expect(screen.queryByText('Merge:')).toBeNull();
  });

  it('shows only the run badge without groups and delivery', () => {
    const run = runView({
      groups: [],
      delivery: { applied: 0, merged: 0, failed: 0, inProgress: false, finishedAt: null },
    });
    render(<RunStatuses run={run} entry={null} />);
    expect(labels()).toHaveLength(1);
    expect(parts()).toEqual(['Run']);
  });

  it('opens the resolver from the delivery badge', () => {
    const onSelect = vi.fn();
    const run = runView({
      groups: [groupRow({ status: 'merged' })],
      delivery: { applied: 0, merged: 1, failed: 0, inProgress: false, finishedAt: null },
      resolver: {
        status: 'running',
        wait: null,
        round: 1,
        rounds: 2,
        conflicts: ['a.ts'],
        reason: null,
      },
    });
    render(<RunStatuses run={run} entry={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('delivery 0/1'));
    expect(onSelect).toHaveBeenCalledWith('_resolve');
  });
});
