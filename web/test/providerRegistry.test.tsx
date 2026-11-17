// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  REFRESH_MS,
  invalidateProviders,
  useProviderRegistry,
} from '../src/features/providers/page/useProviderRegistry.ts';
import { act, cleanup, render, screen, waitFor } from './render.tsx';
import { fakeApi } from './fixtures.ts';
import { providersView, providerView } from './providerFixtures.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let counter = 0;
const nextRepository = () => `/registry-${(counter += 1)}`;

function Watcher({
  api,
  repository,
  watch,
  id,
}: {
  api: ReturnType<typeof fakeApi>;
  repository: string;
  watch?: unknown;
  id: string;
}) {
  const { view } = useProviderRegistry(api, repository, watch);
  return <p data-testid={id}>{view ? view.providers.map((p) => p.slug).join(',') : 'none'}</p>;
}

describe('the registry hook', () => {
  it('shares one request between the hooks of one project and reads again after a write', async () => {
    const repository = nextRepository();
    let slug = 'zai';
    const api = fakeApi({
      providers: vi.fn(async () => providersView({ providers: [providerView(slug)] })),
    });
    render(
      <>
        <Watcher api={api} repository={repository} id="a" />
        <Watcher api={api} repository={repository} id="b" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('zai'));
    expect(screen.getByTestId('b').textContent).toBe('zai');
    expect(api.providers).toHaveBeenCalledTimes(1);

    slug = 'openai';
    await act(async () => {
      await invalidateProviders(repository);
    });
    expect(api.providers).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('a').textContent).toBe('openai');
    expect(screen.getByTestId('b').textContent).toBe('openai');
  });

  it('reads again when the runs change, at most once in five seconds', async () => {
    vi.useFakeTimers();
    const repository = nextRepository();
    const api = fakeApi({
      providers: vi.fn(async () => providersView({ providers: [providerView('zai')] })),
    });
    const { rerender } = render(<Watcher api={api} repository={repository} watch={0} id="a" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.providers).toHaveBeenCalledTimes(1);

    // a change right after the read waits for the end of the window
    rerender(<Watcher api={api} repository={repository} watch={1} id="a" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS - 1000);
    });
    expect(api.providers).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.providers).toHaveBeenCalledTimes(2);

    // several changes in a row make one read
    rerender(<Watcher api={api} repository={repository} watch={2} id="a" />);
    rerender(<Watcher api={api} repository={repository} watch={3} id="a" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });
    expect(api.providers).toHaveBeenCalledTimes(3);

    // after a quiet window the next change reads at once
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });
    rerender(<Watcher api={api} repository={repository} watch={4} id="a" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.providers).toHaveBeenCalledTimes(4);
  });
});
