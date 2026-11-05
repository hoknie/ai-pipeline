// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupScreen } from '../src/components/runs/GroupScreen.tsx';
import { RunHeader } from '../src/components/runs/RunHeader.tsx';

import { fakeApi, groupRow, groupView, runView } from './fixtures.ts';

afterEach(() => cleanup());

const attempts = [
  {
    ...groupView().attempts[0]!,
    seq: 1,
    stepId: 'plan',
    stepName: 'Планировщик',
    status: 'finished',
    verdict: 'done',
  },
  {
    ...groupView().attempts[0]!,
    seq: 2,
    stepId: 'code',
    stepName: 'Кодер',
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

function openMore() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
}

function openGroupMenu(title = 'Вход') {
  fireEvent.keyDown(screen.getByRole('button', { name: `More actions: ${title}` }), {
    key: 'Enter',
  });
}

describe('retry a failed step', () => {
  it('offers the retry in the last attempt of a failed group and keeps it open', async () => {
    const api = panel('failed');
    await screen.findByText('#2 Кодер');
    const blocks = screen.getAllByRole('listitem').filter((item) => item.closest('ol'));
    expect(within(blocks[0]!).queryByText('Retry step')).toBeNull();
    const buttons = within(blocks[1]!).getAllByRole('button', { name: 'Retry step' });
    expect(buttons).toHaveLength(1);
    expect(within(blocks[1]!).queryByRole('alert')?.querySelector('button') ?? null).toBeNull();
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
    await screen.findByText('#2 Кодер');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    openGroupMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('run1', 'login'));
    expect(screen.getAllByRole('button', { name: 'Retry step' }).length).toBeGreaterThan(0);
  });

  it('offers no retry for a merged group', async () => {
    panel('merged');
    await screen.findByText('#2 Кодер');
    expect(screen.queryByText('Retry step')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions: Вход' })).toBeNull();
  });

  it('offers no retry for a group that did not fail', async () => {
    panel('running');
    await screen.findByText('#2 Кодер');
    expect(screen.queryByText('Retry step')).toBeNull();
  });
});

describe('retry with the current config', () => {
  it('offers it next to the retry of a failed group and sends refreshConfig', async () => {
    const api = panel('failed');
    await screen.findByText('#2 Кодер');
    expect(screen.queryByRole('button', { name: 'Retry with current config' })).toBeNull();
    openGroupMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry with current config' }));
    await waitFor(() =>
      expect(api.retry).toHaveBeenCalledWith('run1', 'login', { refreshConfig: true }),
    );
  });

  it('shows the refusal as an error', async () => {
    const onError = vi.fn();
    const api = fakeApi({
      group: vi.fn(async () => groupView({ attempts })),
      retry: vi.fn(async () => {
        throw new Error('configuration not loaded: swarm.max: must be 1-50');
      }),
    });
    render(
      <GroupScreen
        api={api}
        runId="run1"
        row={groupRow({ status: 'failed', reason: 'interrupted' })}
        draftKey="run1/login"
        drafts={{}}
        onDraft={() => undefined}
        onClearDrafts={() => undefined}
        onError={onError}
      />,
    );
    await screen.findByText('#2 Кодер');
    expect(screen.queryByRole('button', { name: 'Retry with current config' })).toBeNull();
    openGroupMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry with current config' }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('configuration not loaded: swarm.max: must be 1-50'),
    );
  });

  it('is not offered for a merged group', async () => {
    panel('merged');
    await screen.findByText('#2 Кодер');
    expect(screen.queryByText('Retry with current config')).toBeNull();
  });

  it('retries every failed group from the header with refreshConfig', async () => {
    const api = fakeApi();
    const run = runView({
      finished: true,
      groups: [
        groupRow({ slug: 'a', title: 'A', status: 'failed' }),
        groupRow({ slug: 'b', title: 'B', status: 'failed' }),
      ],
    });
    render(<RunHeader run={run} api={api} now={0} onError={() => undefined} />);
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry with current config (2)' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledTimes(2));
    expect(api.retry).toHaveBeenCalledWith('run1', 'a', { refreshConfig: true });
    expect(api.retry).toHaveBeenCalledWith('run1', 'b', { refreshConfig: true });
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
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry failed (2)' }));
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
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry failed (2)' }));
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
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry failed and cancelled (2)' }));
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
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry failed and cancelled (1)' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('run1', '_split'));
  });

  it('shows no item without failed groups', () => {
    render(<RunHeader run={runView()} api={fakeApi()} now={0} onError={() => undefined} />);
    openMore();
    expect(screen.queryByText(/Retry failed/)).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Deliver with --force…' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy run id' })).toBeTruthy();
  });

  it('keeps the retries out of the action row and before the force delivery', () => {
    render(<RunHeader run={run} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Retry failed (2)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry with current config (2)' })).toBeNull();
    openMore();
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(names).toEqual([
      'Retry failed (2)',
      'Retry with current config (2)',
      'Deliver with --force…',
      'Mark as delivered…',
      'Copy run id',
    ]);
  });

  it('disables the items while a retry is running', async () => {
    const api = fakeApi({ retry: vi.fn(() => new Promise<never>(() => undefined)) });
    render(<RunHeader run={run} api={api} now={0} onError={() => undefined} />);
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry failed (2)' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalled());
    openMore();
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: 'Retry failed (2)' }).getAttribute('aria-disabled'),
      ).toBe('true'),
    );
    expect(
      screen
        .getByRole('menuitem', { name: 'Retry with current config (2)' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });
});

describe('accepted answers', () => {
  it('shows the answer in the feedback of the attempt that asked', async () => {
    const api = fakeApi({
      group: vi.fn(async () =>
        groupView({
          attempts: [
            {
              ...groupView().attempts[0]!,
              status: 'finished',
              verdict: 'needs_human',
              feedback: null,
              decision: { question: 'Формат?', answer: 'JSON', by: 'autopilot' },
            },
          ],
        }),
      ),
    });
    panel('done', api);
    const feedback = await screen.findByRole('region', { name: 'feedback' });
    expect(feedback.textContent).toContain('Answer (autopilot):');
    expect(feedback.textContent).toContain('JSON');
  });
});
