import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionView } from '../../src/presentation/ipc/contract/index.ts';
import type { SubscriptionView } from '../../src/feature/notifications/types/index.ts';
import { MemoryStore } from '../feature/integrations/helpers.ts';
import { chatAdapter, fakeChannels } from '../feature/notifications/helpers.ts';

import { harness, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start() {
  const channels = fakeChannels();
  current = await harness(
    undefined,
    {},
    {
      integrations: { adapters: [chatAdapter()], secretStore: new MemoryStore() },
      notifications: { kinds: [channels.factory], restartMs: 20 },
    },
  );
  await current.call('repository_add', { path: current.repo });
  return { h: current, channels };
}

async function connect(h: Harness, name = 'main', scope: { repository?: string } = {}) {
  const added = (await h.call('integration_add', {
    kind: 'chat',
    name,
    ...(scope.repository === undefined ? { global: true } : { repository: scope.repository }),
    params: { chat_id: '-100' },
  })) as ConnectionView;
  await h.call('integration_secret_set', { id: added.id, slot: 'token', value: 'secret-token' });
  await h.call('integration_enable', { id: added.id });
  return added.id;
}

const subscriptions = async (h: Harness) => (await h.call('notify_list', {})) as SubscriptionView[];

describe('the subscriptions of a project that moves or goes away', () => {
  it('keeps the subscription of a moved project and goes on with the new root', async () => {
    const { h } = await start();
    const connection = await connect(h);
    await h.call('notify_add', { connection, repository: h.repo, events: ['question', 'failed'] });
    const moved = join(realpathSync(mkdtempSync(join(tmpdir(), 'aip-moved-'))), 'repo');
    execFileSync('mv', [h.repo, moved]);
    await h.call('repository_move', { path: h.repo, to: moved });
    const [subscription] = await subscriptions(h);
    expect(subscription?.project).toBe(realpathSync(moved));
    expect(subscription?.events).toEqual(['question', 'failed']);
    expect(subscription?.connection).toBe(connection);
  });

  it('drops the subscriptions of shared connections when the project is forgotten', async () => {
    const { h } = await start();
    const connection = await connect(h);
    await h.call('notify_add', { connection, repository: h.repo });
    await h.call('notify_add', { connection, allProjects: true });
    await h.call('repository_remove', { path: h.repo });
    const rest = await subscriptions(h);
    expect(rest.map((one) => one.project)).toEqual([null]);
  });

  it('refuses to forget a project that has connections of its own', async () => {
    const { h } = await start();
    const own = await connect(h, 'own', { repository: h.repo });
    await h.call('notify_add', { connection: own, repository: h.repo });
    await expect(h.call('repository_remove', { path: h.repo })).rejects.toThrow(
      /still has integration connections/,
    );
    expect(await subscriptions(h)).toHaveLength(1);
  });

  it('keeps the subscriptions over a restart of the daemon', async () => {
    const { h } = await start();
    const connection = await connect(h);
    await h.call('notify_add', { connection, repository: h.repo });
    await h.restart();
    expect(await subscriptions(h)).toHaveLength(1);
  });
});
