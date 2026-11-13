// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunHeader } from '../src/features/runs/header/RunHeader.tsx';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';
import { fakeApi, groupRow, runView } from './fixtures.ts';

afterEach(cleanup);

const button = (name: string) => screen.queryByRole('button', { name });

describe('cancelling the auto delivery in the run header', () => {
  const show = (run: ReturnType<typeof runView>, api = fakeApi(), onError = vi.fn()) => {
    render(<RunHeader run={run} api={api} now={0} onError={onError} />);
    return { api, onError };
  };

  it('replaces Deliver with Cancel auto delivery for an unfinished run', async () => {
    const { api } = show(runView({ autoDeliver: true, finished: false }));
    expect(button('Deliver')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel auto delivery' }));
    await waitFor(() => expect(api.cancelAutoDelivery).toHaveBeenCalledWith('run1'));
  });

  it('shows Deliver without the cancel button when auto delivery is off or the run is finished with a pending delivery', () => {
    show(runView({ autoDeliver: false, finished: false }));
    expect(button('Deliver')).not.toBeNull();
    expect(button('Cancel auto delivery')).toBeNull();
    cleanup();
    show(
      runView({
        autoDeliver: true,
        finished: true,
        delivery: { applied: 0, merged: 1, failed: 0, inProgress: false, finishedAt: null },
      }),
    );
    expect(button('Deliver')).not.toBeNull();
    expect(button('Cancel auto delivery')).toBeNull();
  });

  it('hides Deliver and the steps button for a finished run with nothing to deliver', () => {
    show(runView({ finished: true }));
    expect(button('Deliver')).toBeNull();
    expect(screen.queryByRole('button', { name: /steps/i })).toBeNull();
    cleanup();
    show(runView({ finished: false }));
    expect(button('Deliver')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /steps/i })).not.toBeNull();
  });

  it('passes an API error to onError', async () => {
    const api = fakeApi({
      cancelAutoDelivery: vi.fn(async () => {
        throw new Error('run is finished');
      }),
    });
    const { onError } = show(runView({ autoDeliver: true, finished: false }), api);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel auto delivery' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('run is finished'));
  });
});

describe('pause and continue in the run header', () => {
  it('shows Continue right after the answer to a pause, without an event of the stream', async () => {
    const api = fakeApi();
    render(<RunHeader run={runView()} api={api} now={0} onError={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(button('Continue')).not.toBeNull());
    expect(api.pauseRun).toHaveBeenCalledWith('run1', '/repo');
    expect(button('Pause')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(api.queueRunNow).toHaveBeenCalledWith('q9'));
    expect(api.calls).toContainEqual(['queueRunNow', '/repo']);
  });

  it('shows Continue for a run the stream reports as held with its item', () => {
    const run = runView({ hold: 'paused', state: 'paused', queueItem: 'q3' });
    render(<RunHeader run={run} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(button('Continue')).not.toBeNull();
    expect(button('Pause')).toBeNull();
  });

  it('shows Continue for a frozen run with an item', async () => {
    const api = fakeApi();
    const run = runView({ hold: 'frozen', state: 'frozen', queueItem: 'q4' });
    render(<RunHeader run={run} api={api} now={0} onError={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(api.queueRunNow).toHaveBeenCalledWith('q4'));
  });

  it('shows neither button for a finished run', () => {
    const run = runView({
      finished: true,
      state: 'finished',
      groups: [groupRow({ status: 'merged' })],
    });
    render(<RunHeader run={run} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(button('Pause')).toBeNull();
    expect(button('Continue')).toBeNull();
  });

  it('reports a refused continue and keeps the button', async () => {
    const onError = vi.fn();
    const api = fakeApi({
      queueRunNow: vi.fn(async () => {
        throw new Error('no place');
      }),
    });
    const run = runView({ hold: 'paused', state: 'paused', queueItem: 'q3' });
    render(<RunHeader run={run} api={api} now={0} onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('no place'));
    expect(button('Continue')).not.toBeNull();
  });
});

describe('Create subtask in the More menu', () => {
  const open = async () => {
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More' }), {
      button: 0,
      ctrlKey: false,
    });
    return screen.findByRole('menuitem', { name: 'Create subtask…' });
  };

  it.each([
    ['active', {}],
    ['finished', { finished: true, state: 'finished' as const }],
    ['cancelled', { finished: true, state: 'cancelled' as const }],
  ])('is offered for a %s run and passes the run on', async (_name, overrides) => {
    const onSubtask = vi.fn();
    const run = runView(overrides);
    render(
      <RunHeader
        run={run}
        api={fakeApi()}
        now={0}
        onError={() => undefined}
        onSubtask={onSubtask}
      />,
    );
    fireEvent.click(await open());
    expect(onSubtask).toHaveBeenCalledWith(run);
  });

  it('is absent without the handler', async () => {
    render(<RunHeader run={runView()} api={fakeApi()} now={0} onError={() => undefined} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More' }), {
      button: 0,
      ctrlKey: false,
    });
    await screen.findByRole('menuitem', { name: 'Copy run id' });
    expect(screen.queryByRole('menuitem', { name: 'Create subtask…' })).toBeNull();
  });
});
