import { describe, expect, it } from 'vitest';

import { QueueItems } from '../../../src/feature/queue/services/items.ts';
import { ConfigService } from '../../../src/feature/swarm-config/services/index.ts';

function items(serverMode: boolean): QueueItems {
  const config = new ConfigService({ environment: {} });
  config.serverSettings = () => ({ enabled: serverMode }) as never;
  return new QueueItems({
    config,
    registry: { rootOf: async (path: string) => path, requireEnabled: () => undefined },
    store: {
      of: () => {
        throw new Error('the task was not refused');
      },
    },
  } as never);
}

const task = { repository: '/repo', pipeline: 'feature', task: 'A' };

describe('the delivery mode of a task in the server mode', () => {
  it.each(['worktree', 'commit'] as const)('refuses %s before the task is queued', async (mode) => {
    await expect(items(true).enqueue({ ...task, deliveryMode: mode } as never)).rejects.toThrow(
      /aip run apply/,
    );
  });

  it('lets a task of the local mode through to the queue', async () => {
    await expect(
      items(false).enqueue({ ...task, deliveryMode: 'worktree' } as never),
    ).rejects.toThrow('the task was not refused');
  });
});
