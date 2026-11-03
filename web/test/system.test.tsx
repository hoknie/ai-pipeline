// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

import { App } from '../src/App.tsx';
import { GroupScreen } from '../src/components/runs/GroupScreen.tsx';
import { defaultEntry, orderEntries } from '../src/components/order.ts';

import {
  FakeEventSource,
  fakeApi,
  groupRow,
  groupView,
  openFake,
  runView,
  systemRow,
  topologyOf,
  workflowOf,
  workflowsView,
} from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  toast.dismiss();
});

function mount(runs: ReturnType<typeof runView>[], extra: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({ group: vi.fn(async () => groupView()), ...extra });
  render(<App api={api} openStream={openFake} />);
  act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs }));
  return api;
}

describe('order of entries', () => {
  it('does not let a failed resolver overtake a group that waits for a human', () => {
    const run = runView({
      groups: [
        groupRow({ slug: 'a', status: 'done' as 'merged' }),
        groupRow({ slug: 'b', status: 'needs_human' }),
      ],
      system: [systemRow('resolve', { status: 'failed' })],
    });
    expect(orderEntries(run).map((entry) => entry.slug)).toEqual(['b', 'a', '_resolve']);
    expect(defaultEntry(run)?.slug).toBe('b');
  });

  it('opens the split when the run has no groups', () => {
    const run = runView({ groups: [], system: [systemRow('split')] });
    expect(defaultEntry(run)?.slug).toBe('_split');
  });
});

describe('system steps in the runs section', () => {
  it('shows the split step on the right and no group list while the task is split', async () => {
    mount([runView({ groups: [], system: [systemRow('split')] })]);
    expect(await screen.findByRole('region', { name: 'group Split into groups' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'run groups' })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Changes/ })).toBeNull();
  });

  it('lists groups and then system steps with a mark', async () => {
    mount([
      runView({
        groups: [groupRow({ slug: 'a', title: 'Альфа' }), groupRow({ slug: 'b', title: 'Бета' })],
        system: [systemRow('message', { status: 'done' })],
      }),
    ]);
    const list = await screen.findByRole('list', { name: 'run groups' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Альфа'),
      expect.stringContaining('Бета'),
      expect.stringContaining('Commit message'),
    ]);
    expect(items[2]!.textContent).toContain('system step');
  });

  it('opens the split by its address', async () => {
    window.location.hash = '#runs/run1/_split';
    mount([runView({ groups: [], system: [systemRow('split')] })]);
    expect(await screen.findByRole('region', { name: 'group Split into groups' })).toBeTruthy();
  });

  it('answers the question of the split step', async () => {
    const api = mount(
      [
        runView({
          state: 'needs_human',
          groups: [],
          system: [systemRow('split', { status: 'needs_human', question: 'Сколько групп?' })],
        }),
      ],
      { group: vi.fn(async () => groupView({ slug: '_split', status: 'needs_human' })) },
    );
    expect(await screen.findByText('Сколько групп?')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('answer for Split into groups'), {
      target: { value: 'три' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('run1', '_split', 'три'));
  });

  it('cancels a running resolver after the confirmation', async () => {
    const api = mount([
      runView({ groups: [groupRow({ status: 'merged' })], system: [systemRow('resolve')] }),
    ]);
    fireEvent.click(await screen.findByRole('button', { name: /Delivery conflict resolution/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel group' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel group' }),
    );
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('run1', '_resolve'));
  });

  it('opens the resolver from the header row', async () => {
    mount([
      runView({
        groups: [groupRow({ status: 'merged' })],
        resolver: {
          status: 'running',
          wait: null,
          round: 1,
          rounds: 2,
          conflicts: [],
          reason: null,
        },
        system: [systemRow('resolve')],
      }),
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'resolver' }));
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/_resolve'));
    expect(
      await screen.findByRole('region', { name: 'group Delivery conflict resolution' }),
    ).toBeTruthy();
  });
});

describe('retry of system steps', () => {
  const screenOf = (row: ReturnType<typeof systemRow>, deliverable: boolean) => {
    const api = fakeApi({ group: vi.fn(async () => groupView({ slug: row.slug, attempts: [] })) });
    render(
      <GroupScreen
        api={api}
        runId="run1"
        row={row}
        draftKey={`run1/${row.slug}`}
        drafts={{}}
        onDraft={() => undefined}
        onClearDrafts={() => undefined}
        onError={() => undefined}
        deliverable={deliverable}
        onDeliver={() => api.apply('run1', false)}
      />,
    );
    return api;
  };

  it('retries a failed split like a group', async () => {
    const api = screenOf(systemRow('split', { status: 'failed' }), false);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('run1', '_split'));
  });

  it('offers a failed resolver only the retry of the delivery', async () => {
    const api = screenOf(systemRow('resolve', { status: 'failed', reason: 'boom' }), true);
    await screen.findByText('boom');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry step' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry delivery' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('run1', false));
    expect(api.retry).not.toHaveBeenCalled();
  });

  it('hides the retry of the delivery when nothing waits for it', async () => {
    screenOf(systemRow('message', { status: 'failed' }), false);
    await screen.findByRole('region', { name: 'group Commit message' });
    expect(screen.queryByRole('button', { name: 'Retry delivery' })).toBeNull();
  });
});

describe('opening a split from the topology', () => {
  it('opens the runs section with the split screen', async () => {
    const workflow = workflowOf({
      id: 'feature',
      split: { specialist: 'plan', maxGroups: 3, workflow: null },
    });
    const run = runView({
      split: { status: 'running', wait: null, question: null, questions: null, reason: null },
      groups: [],
      system: [systemRow('split')],
      topology: topologyOf(),
    });
    const api = fakeApi({
      workflows: vi.fn(async () => workflowsView({ workflows: [workflow] })),
      group: vi.fn(async () => groupView({ slug: '_split' })),
    });
    window.location.hash = '#topology/feature';
    render(<App api={api} openStream={openFake} />);
    act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs: [run] }));
    fireEvent.click(await screen.findByTestId('stage-split'));
    fireEvent.click(
      within(await screen.findByRole('complementary', { name: /^node/ })).getByRole('button', {
        name: 'добавить вход',
      }),
    );
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/_split'));
    expect(await screen.findByRole('region', { name: 'group Split into groups' })).toBeTruthy();
  });
});

describe('system stages in the run header', () => {
  const stages = () => screen.getByLabelText('System stages');

  it('shows the finished split, the commit message and the delivery as one row', async () => {
    mount([
      runView({
        groups: [groupRow({ status: 'merged' })],
        split: { status: 'done', wait: null, question: null, questions: null, reason: null },
        system: [systemRow('split', { status: 'done' }), systemRow('message')],
        deliveryStage: { status: 'pending' },
      }),
    ]);
    await screen.findByLabelText('System stages');
    expect(within(stages()).getByRole('button', { name: 'Split into groups' })).toBeTruthy();
    expect(within(stages()).getByText('Commit message')).toBeTruthy();
    expect(within(stages()).getByText('Delivery')).toBeTruthy();
    expect(screen.queryByText('splitting into groups')).toBeNull();
  });

  it('opens a system step from the row', async () => {
    mount([
      runView({
        groups: [groupRow({ status: 'merged' })],
        system: [systemRow('message')],
        deliveryStage: { status: 'pending' },
      }),
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Commit message' }));
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/_message'));
  });

  it('shows a failed delivery without a resolver', async () => {
    mount([
      runView({
        groups: [groupRow({ status: 'merged', delivery: 'apply_failed' })],
        deliveryStage: {
          status: 'apply_failed',
          reason: 'does not exist in index',
          groups: ['login'],
        },
      }),
    ]);
    await screen.findByLabelText('System stages');
    expect(within(stages()).getByText('Delivery failed')).toBeTruthy();
    expect(within(stages()).getByTitle('does not exist in index')).toBeTruthy();
  });

  it('has no row without system stages', async () => {
    mount([runView()]);
    await screen.findByRole('region', { name: /group/ });
    expect(screen.queryByLabelText('System stages')).toBeNull();
  });
});

describe('a failed delivery on the group screen', () => {
  const failed = (deliverable = true) => {
    const api = fakeApi({
      group: vi.fn(async () =>
        groupView({
          status: 'merged',
          delivery: {
            state: 'apply_failed',
            reason: 'does not exist in index',
            files: [],
            conflicts: [],
            userEdits: [],
          },
        }),
      ),
    });
    const run = runView({ groups: [groupRow({ status: 'merged', delivery: 'apply_failed' })] });
    render(
      <GroupScreen
        api={api}
        runId="run1"
        row={run.groups[0]!}
        draftKey="run1/login"
        drafts={{}}
        onDraft={() => {}}
        onClearDrafts={() => {}}
        onError={() => {}}
        deliverable={deliverable}
        onDeliver={() => api.apply('run1', false)}
        run={run}
        onForceDeliver={() => api.apply('run1', true)}
      />,
    );
    return api;
  };

  it('shows the reason and retries the delivery', async () => {
    const api = failed();
    expect(await screen.findByText('does not exist in index')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry delivery' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('run1', false));
    await screen.findByText('Delivery started');
  });

  it('delivers with --force after the dialog', async () => {
    const api = failed();
    await screen.findByText('does not exist in index');
    fireEvent.click(screen.getByRole('button', { name: 'Deliver with --force…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Deliver/ }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('run1', true));
  });

  it('disables both buttons while a delivery is in progress', async () => {
    failed(false);
    await screen.findByText('does not exist in index');
    expect(
      (screen.getByRole('button', { name: 'Retry delivery' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Deliver with --force…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
