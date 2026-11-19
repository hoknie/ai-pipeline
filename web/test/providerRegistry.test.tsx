// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  invalidateProviders,
  useProviderRegistry,
} from '../src/features/providers/page/useProviderRegistry.ts';
import { act, cleanup, render, screen, waitFor } from './render.tsx';
import type { Api } from '../src/shared/api/api.ts';
import { liveTopics } from '../src/shared/api/live/topics.ts';
import { attachLive, fakeApi } from './fixtures.ts';
import { providersView, providerView } from './providerFixtures.ts';

afterEach(() => {
  cleanup();
  liveTopics.detach();
  vi.useRealTimers();
});

let counter = 0;
const nextRepository = () => `/registry-${(counter += 1)}`;

function Watcher({ api, repository, id }: { api: Api; repository: string; id: string }) {
  const { view } = useProviderRegistry(api, repository);
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

  it('takes the registry from one subscription and asks again when the window gets focus', async () => {
    const repository = nextRepository();
    const api = fakeApi({
      providers: vi.fn(async () => providersView({ providers: [providerView('zai')] })),
    });
    const socket = attachLive();
    render(
      <>
        <Watcher api={api.forRepository(repository)} repository={repository} id="a" />
        <Watcher api={api.forRepository(repository)} repository={repository} id="b" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('zai'));
    // one subscription for both hooks, bound to the project
    expect(socket.subscriptions('providers').map((held) => held.topic)).toEqual([
      { kind: 'providers', repository },
    ]);
    // the server sends the registry when a run changed it
    act(() => socket.topic('providers', providersView({ providers: [providerView('openai')] })));
    expect(screen.getByTestId('a').textContent).toBe('openai');
    expect(screen.getByTestId('b').textContent).toBe('openai');
    // the focus asks over the connection, not with a request of the panel
    const asked = socket.sent.length;
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(socket.sent.slice(asked)).toEqual([
      { op: 'refresh', id: socket.subscriptions('providers')[0]?.id },
    ]);
    cleanup();
    expect(socket.subscriptions('providers')).toEqual([]);
  });

  it('reads with a request once while there is no connection, and again on focus', async () => {
    const repository = nextRepository();
    let slug = 'zai';
    const api = fakeApi({
      providers: vi.fn(async () => providersView({ providers: [providerView(slug)] })),
    });
    render(<Watcher api={api} repository={repository} id="a" />);
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('zai'));
    expect(api.providers).toHaveBeenCalledTimes(1);
    slug = 'openai';
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('openai'));
    expect(api.providers).toHaveBeenCalledTimes(2);
  });
});
