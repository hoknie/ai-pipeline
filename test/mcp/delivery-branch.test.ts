import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createHostServer } from '../../src/presentation/mcp/host.ts';
import { createWorkerServer } from '../../src/presentation/mcp/worker.ts';

const target = { name: 'feature/new', strategy: 'create' };
const queue = {
  scope: 'project',
  repository: '/repo',
  item: 'q1',
  status: 'stopped',
  parallel: 1,
  autopilot: false,
  autoAnswer: false,
  skipFailed: false,
  autopilotAnswer: null,
  onLimit: 'wait',
  filter: { pipelines: [], tags: [] },
  filterTags: [],
  stop: null,
  runs: [],
  skipped: [],
  items: [],
};

async function connect(worker: boolean) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const send = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (worker) return { item: 'q1' };
    return method === 'run' ? { item: 'q1', number: 1, run: null, queue } : queue;
  };
  const server = worker
    ? createWorkerServer({ token: 'token', split: false, queue: true, repair: false, send })
    : createHostServer({ cwd: '/repo', send });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return { client, calls };
}

describe.each([false, true])('delivery branch MCP (worker: %s)', (worker) => {
  it('forwards the pair and explicit null reset', async () => {
    const { client, calls } = await connect(worker);
    const added = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'work', deliveryBranch: target },
    });
    const edited = await client.callTool({
      name: 'swarm_queue_edit',
      arguments: { item: 'q1', deliveryBranch: null },
    });
    expect(added.isError).toBeFalsy();
    expect(edited.isError).toBeFalsy();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.params.deliveryBranch).toEqual(target);
    expect(calls[1]!.params.deliveryBranch).toBeNull();
    await client.close();
  });

  it('accepts old requests without a delivery branch', async () => {
    const { client, calls } = await connect(worker);
    const result = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'work' },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0]!.params).not.toHaveProperty('deliveryBranch');
    await client.close();
  });

  it.each([{ name: 'feature/new' }, { strategy: 'create' }, { ...target, extra: true }])(
    'refuses an incomplete or non-strict pair %o before sending',
    async (deliveryBranch) => {
      const { client, calls } = await connect(worker);
      for (const [name, args] of [
        ['swarm_queue_add', { pipeline: 'feature', task: 'work' }],
        ['swarm_queue_edit', { item: 'q1' }],
        ...(!worker ? [['swarm_run', { pipeline: 'feature', task: 'work' }] as const] : []),
      ] as const) {
        const result = await client.callTool({ name, arguments: { ...args, deliveryBranch } });
        expect(result.isError).toBe(true);
      }
      expect(calls).toEqual([]);
      await client.close();
    },
  );
});

it('forwards the target through swarm_run', async () => {
  const { client, calls } = await connect(false);
  const result = await client.callTool({
    name: 'swarm_run',
    arguments: { pipeline: 'feature', task: 'work', deliveryBranch: target },
  });
  expect(result.isError).toBeFalsy();
  expect(calls[0]).toMatchObject({ method: 'run', params: { deliveryBranch: target } });
  await client.close();
});
