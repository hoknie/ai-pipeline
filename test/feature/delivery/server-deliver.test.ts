import { describe, expect, it } from 'vitest';

import { DeliverService } from '../../../src/feature/delivery/services/deliver.ts';
import { ConfigService } from '../../../src/feature/swarm-config/services/index.ts';
import { run } from '../runs/helpers.ts';

function service(serverMode: boolean, mode: 'worktree' | 'commit' | 'branch') {
  const state = run(1, { deliveryMode: mode });
  const config = new ConfigService({ environment: {} });
  config.serverSettings = () => ({ enabled: serverMode }) as never;
  const events: string[] = [];
  return {
    events,
    deliver: new DeliverService({
      config,
      states: { get: () => state } as never,
      engine: {
        serial: (work: () => Promise<unknown>) => work(),
        apply: async (_state: unknown, event: { kind: string }) => void events.push(event.kind),
      } as never,
    }),
  };
}

describe('a request to deliver in the server mode', () => {
  it.each(['worktree', 'commit'] as const)('is refused for a run in the %s mode', async (mode) => {
    const { deliver, events } = service(true, mode);
    await expect(deliver.deliver({ runId: 'run000000001' })).rejects.toThrow(/aip run apply/);
    expect(events).toEqual([]);
  });

  it('goes to the machine for a branch run', async () => {
    const { deliver, events } = service(true, 'branch');
    await deliver.deliver({ runId: 'run000000001' });
    expect(events).toEqual(['deliver_requested']);
  });

  it('is not checked in the local mode', async () => {
    const { deliver, events } = service(false, 'worktree');
    await deliver.deliver({ runId: 'run000000001' });
    expect(events).toEqual(['deliver_requested']);
  });
});
