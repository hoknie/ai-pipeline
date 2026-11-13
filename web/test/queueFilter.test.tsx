// @vitest-environment jsdom
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { ApiError } from '../src/shared/api/api.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { FakeEventSource, fakeApi, openFake, queueItem, queueOf } from './fixtures.ts';

function stream(): FakeEventSource {
  const source = FakeEventSource.last;
  if (!source) throw new Error('no event source');
  return source;
}

beforeEach(() => {
  toast.dismiss();
  window.location.hash = '#queue';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(queue = queueOf(), overrides = {}) {
  const api = fakeApi({ queue: vi.fn(async () => queue), ...overrides });
  render(<App api={api} openStream={openFake} />);
  return api;
}

const block = () => screen.findByLabelText('take filter');

describe('take filter block', () => {
  it('stands above the queue controls and is collapsed while the filter is empty', async () => {
    show();
    const filter = await block();
    const controls = await screen.findByLabelText('queue controls');
    expect(
      filter.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(filter).getByRole('button', { name: /Take filter/ })).toBeTruthy();
    expect(within(filter).queryByText('Reset')).toBeNull();
  });

  it('opens with a counter when the filter is set and resets it', async () => {
    const queueSettings = vi.fn(async () => queueOf());
    show(queueOf({ filter: { pipelines: ['feature'], tags: [] } }), { queueSettings });
    const filter = await block();
    expect(within(filter).getByText('1')).toBeTruthy();
    const reset = await within(filter).findByRole('button', { name: 'Reset' });
    fireEvent.click(reset);
    await waitFor(() =>
      expect(queueSettings).toHaveBeenCalledWith({ filter: { pipelines: [], tags: [] } }),
    );
  });

  it('chooses a pipeline and sends only the pipelines', async () => {
    const queueSettings = vi.fn(async () =>
      queueOf({ filter: { pipelines: ['feature'], tags: [] } }),
    );
    show(queueOf(), { queueSettings });
    const filter = await block();
    fireEvent.click(within(filter).getByRole('button', { name: /Take filter/ }));
    fireEvent.click(await within(filter).findByRole('combobox', { name: 'Pipeline' }));
    fireEvent.click(await screen.findByRole('option', { name: /feature/ }));
    await waitFor(() =>
      expect(queueSettings).toHaveBeenCalledWith({ filter: { pipelines: ['feature'] } }),
    );
  });

  it('sends tag names and shows tags by id as selected', async () => {
    const auth = { id: 'ta', repository: '/repo', name: 'auth', color: 'red' as const, task: null };
    const queueSettings = vi.fn(async () => queueOf({ filter: { pipelines: [], tags: ['ta'] } }));
    show(queueOf(), { queueSettings });
    act(() => {
      stream().open();
      stream().send({ event: 'snapshot', seq: 1, runs: [], tags: [auth] });
    });
    const filter = await block();
    fireEvent.click(within(filter).getByRole('button', { name: /Take filter/ }));
    fireEvent.click(await within(filter).findByRole('combobox', { name: 'Tags' }));
    fireEvent.click(await screen.findByRole('option', { name: 'auth' }));
    await waitFor(() => expect(queueSettings).toHaveBeenCalledWith({ filter: { tags: ['auth'] } }));
    expect(await within(filter).findByText('auth')).toBeTruthy();
  });

  it('is disabled in a running queue with a hint', async () => {
    show(queueOf({ status: 'running', filter: { pipelines: ['feature'], tags: [] } }));
    const filter = await block();
    expect(await within(filter).findByText('Stop the queue to change the filter')).toBeTruthy();
    expect(within(filter).getByRole('button', { name: 'Reset' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(
      within(filter).getByRole('combobox', { name: 'Pipeline' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('shows the server error and returns the old value', async () => {
    show(queueOf({ filter: { pipelines: ['feature'], tags: [] } }), {
      queueSettings: vi.fn(async () => {
        throw new ApiError(400, 'queue filter can be changed only while the queue is stopped');
      }),
    });
    const filter = await block();
    fireEvent.click(await within(filter).findByRole('button', { name: 'Reset' }));
    await screen.findByText(/queue filter can be changed only/);
    await waitFor(() => expect(within(filter).getByText('1')).toBeTruthy());
  });
});

describe('items out of the filter', () => {
  it('mutes a task that does not fit and marks it', async () => {
    show(
      queueOf({
        filter: { pipelines: ['feature'], tags: [] },
        items: [
          queueItem('q1', 'Подходит', 1),
          queueItem('q2', 'Другая', 2, { pipeline: 'other', filtered: true }),
        ],
      }),
    );
    const out = await screen.findByRole('listitem', { name: /Другая/ });
    expect(within(out).getByText('Filtered out')).toBeTruthy();
    expect(out.className).toContain('opacity-60');
    const fits = screen.getByRole('listitem', { name: /Подходит/ });
    expect(within(fits).queryByText('Filtered out')).toBeNull();
  });
});
