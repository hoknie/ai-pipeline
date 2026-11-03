// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupScreen } from '../src/components/runs/GroupScreen.tsx';
import { RunHeader } from '../src/components/runs/RunHeader.tsx';

import { fakeApi, groupRow, groupView, runView } from './fixtures.ts';

afterEach(() => cleanup());

const attempts = [
  { ...groupView().attempts[0]!, seq: 1, stepId: 'plan', status: 'finished', verdict: 'done' },
  {
    ...groupView().attempts[0]!,
    seq: 2,
    stepId: 'code',
    status: 'failed',
    verdict: null,
    reason: 'interrupted',
  },
];

function panel(
  status: string,
  api = fakeApi({ group: vi.fn(async () => groupView({ attempts })) }),
) {
  render(
    <GroupScreen
      api={api}
      runId="run1"
      row={groupRow({ status: status as 'failed', reason: 'interrupted' })}
      draftKey="run1/login"
      drafts={{}}
      onDraft={() => undefined}
      onClearDrafts={() => undefined}
      onError={() => undefined}
    />,
  );
  return api;
}

describe('retry a failed step', () => {
  it('offers the retry in the last attempt of a failed group and keeps it open', async () => {
    const api = panel('failed');
    await screen.findByText('#2 code');
    const blocks = screen.getAllByRole('listitem').filter((item) => item.closest('ol'));
    expect(within(blocks[0]!).queryByText('Retry step')).toBeNull();
    const buttons = within(blocks[1]!).getAllByRole('button', { name: 'Retry step' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('run1', 'login'));
    expect(
      within(blocks[1]!)
        .getByRole('button', { name: /^attempt 2/ })
        .getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('offers the retry for a cancelled group, in the panel and in the last attempt', async () => {
    const api = panel('cancelled');
    await screen.findByText('#2 code');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('run1', 'login'));
    expect(screen.getAllByRole('button', { name: 'Retry step' }).length).toBeGreaterThan(0);
  });

  it('offers no retry for a merged group', async () => {
    panel('merged');
    await screen.findByText('#2 code');
    expect(screen.queryByText('Retry step')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers no retry for a group that did not fail', async () => {
    panel('running');
    await screen.findByText('#2 code');
    expect(screen.queryByText('Retry step')).toBeNull();
  });
});

describe('retry every failed group', () => {
  const run = runView({
    finished: true,
    groups: [
      groupRow({ slug: 'a', title: 'A', status: 'failed' }),
      groupRow({ slug: 'b', title: 'B', status: 'failed' }),
      groupRow({ slug: 'c', title: 'C', status: 'merged' }),
    ],
  });

  it('retries both failed groups and leaves the merged one', async () => {
    const api = fakeApi();
    render(<RunHeader run={run} api={api} now={0} onError={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed (2)' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledTimes(2));
    expect(api.retry).toHaveBeenCalledWith('run1', 'a');
    expect(api.retry).toHaveBeenCalledWith('run1', 'b');
  });

  it('reports the groups it could not retry and keeps the others', async () => {
    const onError = vi.fn();
    const api = fakeApi({
      retry: vi.fn(async (_run: string, group: string) => {
        if (group === 'a') throw new Error('group `a` is running');
        return {};
      }),
    });
    render(<RunHeader run={run} api={api} now={0} onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed (2)' }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('Could not retry: A: group `a` is running'),
    );
    expect(api.retry).toHaveBeenCalledWith('run1', 'b');
  });

  it('retries the groups of a cancelled run', async () => {
    const cancelled = runView({
      finished: true,
      state: 'cancelled',
      groups: [
        groupRow({ slug: 'a', title: 'A', status: 'cancelled' }),
        groupRow({ slug: 'b', title: 'B', status: 'cancelled' }),
        groupRow({ slug: 'c', title: 'C', status: 'merged' }),
      ],
    });
    const api = fakeApi();
    render(<RunHeader run={cancelled} api={api} now={0} onError={() => undefined} />);
    expect(screen.getByLabelText('Cancelled (cancelled)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed and cancelled (2)' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledTimes(2));
    expect(api.retry).toHaveBeenCalledWith('run1', 'a');
    expect(api.retry).toHaveBeenCalledWith('run1', 'b');
  });

  it('retries the split step of a run cancelled while splitting', async () => {
    const cancelled = runView({
      finished: true,
      state: 'cancelled',
      split: { status: 'cancelled', wait: null, question: null, questions: null, reason: null },
      groups: [],
    });
    const api = fakeApi();
    render(<RunHeader run={cancelled} api={api} now={0} onError={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed and cancelled (1)' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('run1', '_split'));
  });

  it('shows no button without failed groups', () => {
    render(<RunHeader run={runView()} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(screen.queryByText(/Retry failed/)).toBeNull();
  });
});
