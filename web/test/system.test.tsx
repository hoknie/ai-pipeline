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
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel group' }),
    );
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('run1', '_resolve'));
  });

  it('opens the resolver from the delivery badge', async () => {
    mount([
      runView({
        groups: [groupRow({ status: 'merged' })],
        resolver: {
          status: 'running',
          wait: null,
          round: 1,
          rounds: 2,
          conflicts: ['src/app.ts'],
          reason: null,
        },
        delivery: { applied: 0, merged: 1, failed: 0, inProgress: true, finishedAt: null },
        system: [systemRow('resolve')],
      }),
    ]);
    const badge = await screen.findByRole('button', { name: /Delivering/ });
    expect(badge.querySelector('[tabindex], button')).toBeNull();
    act(() => badge.focus());
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('round 1/2');
    expect(tip.textContent).toContain('src/app.ts');
    fireEvent.click(badge);
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/_resolve'));
    window.location.hash = '#runs/run1';
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1'));
    fireEvent.keyDown(badge, { key: 'Enter' });
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
    fireEvent.keyDown(
      await screen.findByRole('button', { name: 'More actions: Split into groups' }),
      { key: 'Enter' },
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('run1', '_split'));
  });

  it('retries a failed split with the current config', async () => {
    const api = screenOf(systemRow('split', { status: 'failed' }), false);
    fireEvent.keyDown(
      await screen.findByRole('button', { name: 'More actions: Split into groups' }),
      { key: 'Enter' },
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry with current config' }));
    await waitFor(() =>
      expect(api.retry).toHaveBeenCalledWith('run1', '_split', { refreshConfig: true }),
    );
  });

  it('offers a failed resolver only the retry of the delivery', async () => {
    const api = screenOf(systemRow('resolve', { status: 'failed', reason: 'boom' }), true);
    await screen.findByText('boom');
    expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry step' })).toBeNull();
    expect(screen.queryByText('Retry with current config')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry delivery' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('run1', false));
    expect(api.retry).not.toHaveBeenCalled();
  });

  it('hides the retry of the delivery when nothing waits for it', async () => {
    screenOf(systemRow('message', { status: 'failed' }), false);
    await screen.findByRole('region', { name: 'group Commit message' });
    expect(screen.queryByRole('button', { name: 'Retry delivery' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry with current config' })).toBeNull();
  });
});

describe('opening a split from the topology', () => {
  it('opens the runs section with the split screen', async () => {
    const workflow = workflowOf({
      id: 'feature',
      split: { specialist: 'plan', maxGroups: 3, workflow: null, workflowName: null },
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
  it('has only the run and delivery badges and no stages or resolver row', async () => {
    mount([
      runView({
        state: 'finished',
        groups: [groupRow({ status: 'merged' })],
        split: { status: 'done', wait: null, question: null, questions: null, reason: null },
        system: [systemRow('split', { status: 'done' }), systemRow('message')],
        deliveryStage: { status: 'pending' },
        delivery: { applied: 1, merged: 1, failed: 0, inProgress: false, finishedAt: null },
        resolver: {
          status: 'running',
          wait: null,
          round: 1,
          rounds: 2,
          conflicts: [],
          reason: null,
        },
      }),
    ]);
    const header = await screen.findByRole('banner', { name: 'run' });
    expect(screen.queryByLabelText('System stages')).toBeNull();
    expect(within(header).queryByText(/resolver/i)).toBeNull();
    expect(within(header).queryByText('Commit message')).toBeNull();
    expect(
      Array.from(header.querySelectorAll('[aria-label$=")"]')).map((node) =>
        node.getAttribute('aria-label'),
      ),
    ).toEqual([expect.stringMatching(/\(finished\)$/), 'Delivered (applied)']);
  });

  const merged3 = () => [1, 2, 3].map((n) => groupRow({ slug: `g${n}`, status: 'merged' }));
  const badgeLabels = (header: HTMLElement) =>
    Array.from(header.querySelectorAll('[aria-label$=")"]')).map((node) =>
      node.getAttribute('aria-label'),
    );

  it('shows exactly one delivery element at 2/3 in the header', async () => {
    mount([
      runView({
        groups: merged3(),
        delivery: { applied: 2, merged: 3, failed: 0, inProgress: false, finishedAt: null },
      }),
    ]);
    const header = await screen.findByRole('banner', { name: 'run' });
    expect(badgeLabels(header)).toEqual([
      expect.stringMatching(/\(active\)$/),
      'delivery 2/3 (pending)',
    ]);
    const texts = within(header)
      .queryAllByText(/deliver/i)
      .filter((node) => node.closest('button')?.textContent?.trim() !== 'Deliver');
    for (const text of ['Delivering', 'Delivery failed', 'Delivered']) {
      expect(texts.some((node) => node.textContent?.includes(text))).toBe(false);
    }
  });

  it('shows only the Delivering badge while delivering, even with failures', async () => {
    mount([
      runView({
        groups: merged3(),
        delivery: { applied: 0, merged: 3, failed: 1, inProgress: true, finishedAt: null },
      }),
    ]);
    const header = await screen.findByRole('banner', { name: 'run' });
    const labels = badgeLabels(header);
    expect(labels).toHaveLength(2);
    expect(labels[1]).toMatch(/^Delivering/);
    expect(within(header).queryByText(/Delivery failed/)).toBeNull();
  });

  it('shows only the run state badge when there is nothing to deliver', async () => {
    mount([
      runView({
        groups: [groupRow({ status: 'running' })],
        delivery: { applied: 0, merged: 0, failed: 0, inProgress: false, finishedAt: null },
      }),
    ]);
    const header = await screen.findByRole('banner', { name: 'run' });
    expect(badgeLabels(header)).toHaveLength(1);
  });

  it('shows the reason of a failed delivery in the badge tooltip', async () => {
    mount([
      runView({
        groups: [groupRow({ status: 'merged', delivery: 'apply_failed' })],
        delivery: { applied: 0, merged: 1, failed: 1, inProgress: false, finishedAt: null },
        deliveryStage: {
          status: 'apply_failed',
          reason: 'does not exist in index',
          groups: ['login'],
        },
      }),
    ]);
    const header = await screen.findByRole('banner', { name: 'run' });
    expect(within(header).getByText('Delivery failed 1')).toBeTruthy();
    expect(within(header).getByTitle('does not exist in index')).toBeTruthy();
  });

  it('keeps the delivery badge a plain badge without a resolver', async () => {
    mount([
      runView({
        groups: [groupRow({ status: 'merged' })],
        delivery: { applied: 0, merged: 1, failed: 0, inProgress: false, finishedAt: null },
      }),
    ]);
    const header = await screen.findByRole('banner', { name: 'run' });
    expect(within(header).getByText('delivery 0/1')).toBeTruthy();
    expect(within(header).queryByRole('button', { name: /delivery 0\/1/ })).toBeNull();
    fireEvent.click(within(header).getByText('delivery 0/1'));
    expect(window.location.hash).not.toContain('_resolve');
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
            finishedAt: null,
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

describe('the outcome of a delivery started in the panel', () => {
  type Delivery = ReturnType<typeof groupView>['delivery'];
  const attempt = (overrides: Partial<Delivery>): Delivery => ({
    state: 'apply_failed',
    reason: 'patch does not apply',
    files: [],
    conflicts: [],
    userEdits: [],
    finishedAt: 1000,
    ...overrides,
  });
  const stuck = (overrides: Parameters<typeof runView>[0] = {}) =>
    runView({
      groups: [groupRow({ status: 'merged', delivery: 'apply_failed' })],
      system: [systemRow('message', { status: 'failed' })],
      delivery: { applied: 0, merged: 1, failed: 1, inProgress: false, finishedAt: 1000 },
      deliveryStage: { status: 'apply_failed', reason: 'patch does not apply', groups: ['login'] },
      ...overrides,
    });
  const result = (pending: boolean, delivery: Delivery) => ({
    runId: 'run1',
    pending,
    groups: [{ slug: 'login', delivery }],
  });
  const open = (apply: ReturnType<typeof vi.fn>, extra = {}) => {
    window.location.hash = '#runs/run1/_message';
    const api = mount([stuck()], { apply, ...extra } as never);
    return api;
  };
  const send = (run: ReturnType<typeof runView>, seq: number) =>
    act(() => FakeEventSource.last!.send({ event: 'run', seq, run }));
  const toasts = () => [
    ...new Set(
      Array.from(document.querySelectorAll('[data-sonner-toast]')).map((node) => node.textContent),
    ),
  ];
  const retry = async () =>
    fireEvent.click(await screen.findByRole('button', { name: 'Retry delivery' }));

  it('reports a repeated failure at once instead of "Delivery started"', async () => {
    const apply = vi.fn(async () =>
      result(false, attempt({ reason: 'patch does not apply\nsecond line', finishedAt: 2000 })),
    );
    open(apply);
    await retry();
    expect(await screen.findByText('Delivery failed again: patch does not apply')).toBeTruthy();
    expect(screen.queryByText('Delivery started')).toBeNull();
  });

  it('reports a finished delivery', async () => {
    open(vi.fn(async () => result(false, attempt({ state: 'applied', reason: null }))));
    await retry();
    expect(await screen.findByText('Delivered')).toBeTruthy();
    expect(screen.queryByText('Delivery started')).toBeNull();
  });

  it('reports a delivery that goes on once the run gets a new delivery time', async () => {
    open(vi.fn(async () => result(true, attempt({}))));
    await retry();
    expect(await screen.findByText('Delivery started')).toBeTruthy();
    send(
      stuck({
        delivery: { applied: 0, merged: 1, failed: 1, inProgress: true, finishedAt: 1000 },
        deliveryStage: { status: 'delivering' },
      }),
      2,
    );
    expect(toasts()).not.toContain('Delivered');
    send(
      stuck({
        groups: [groupRow({ status: 'merged', delivery: 'applied' })],
        delivery: { applied: 1, merged: 1, failed: 0, inProgress: false, finishedAt: 3000 },
        deliveryStage: { status: 'applied' },
      }),
      3,
    );
    await waitFor(() => expect(toasts()).toContain('Delivered'));
  });

  it('says nothing about the outcome when the delivery is cancelled', async () => {
    open(vi.fn(async () => result(true, attempt({}))));
    await retry();
    await screen.findByText('Delivery started');
    send(
      stuck({
        delivery: { applied: 0, merged: 1, failed: 1, inProgress: true, finishedAt: 1000 },
        deliveryStage: { status: 'delivering' },
      }),
      2,
    );
    send(stuck(), 3);
    await act(async () => undefined);
    expect(toasts()).toEqual(['Delivery started']);
  });

  it('keeps the retry button on the step, disabled and loading, while delivering', async () => {
    open(vi.fn());
    send(
      stuck({
        delivery: { applied: 0, merged: 1, failed: 1, inProgress: true, finishedAt: 1000 },
        deliveryStage: { status: 'delivering' },
      }),
      2,
    );
    const button = (await screen.findByRole('button', {
      name: 'Retry delivery',
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      within(await screen.findByRole('status', { name: 'Delivery' })).getByText('Delivering…'),
    ).toBeTruthy();
  });

  it('shows the last attempt on the step line and rereads the reason of a new attempt', async () => {
    const group = vi
      .fn()
      .mockResolvedValueOnce(
        groupView({ status: 'merged', delivery: attempt({ reason: 'reason A' }) }),
      )
      .mockResolvedValue(
        groupView({
          status: 'merged',
          delivery: attempt({ reason: 'reason B', finishedAt: 5000 }),
        }),
      );
    window.location.hash = '#runs/run1/login';
    mount([stuck()], { group } as never);
    expect(await screen.findByText('reason A')).toBeTruthy();
    send(
      stuck({
        delivery: { applied: 0, merged: 1, failed: 1, inProgress: false, finishedAt: 5000 },
        deliveryStage: { status: 'apply_failed', reason: 'reason B', groups: ['login'] },
      }),
      2,
    );
    expect(await screen.findByText('reason B')).toBeTruthy();
    expect(screen.queryByText('reason A')).toBeNull();
  });
});
