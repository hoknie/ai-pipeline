// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import type { Api } from '../src/shared/api/api.ts';

import { act, cleanup, render, screen } from './render.tsx';
import { FakeSocket, fakeApi, openFake, queueOf, repositoryView } from './fixtures.ts';

const APP = '/work/app';

beforeEach(() => {
  window.location.hash = '#settings/project/queue';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('queue settings of a project in the global queue mode', () => {
  it('shows the note instead of loading forever', async () => {
    const { repository: _repository, autoDeliver: _a, deliveryMode: _d, ...rest } = queueOf();
    const global = {
      ...rest,
      scope: 'global',
      filter: { pipelines: [], projects: [], tags: [] },
      items: [],
      runs: [],
      skipped: [],
      max: 4,
    };
    const api = fakeApi({ queue: vi.fn(async () => global as never) });
    render(<App api={api as Api} openStream={openFake} />);
    act(() => {
      FakeSocket.last?.send({
        event: 'snapshot',
        seq: 1,
        runs: [],
        queues: [],
        globalQueue: global,
        repositories: [repositoryView(APP)],
        tags: [],
      });
    });
    expect(await screen.findByText(/The queue is global/)).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading queue' })).toBeNull();
  });
});
