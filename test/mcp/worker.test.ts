import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createWorkerServer } from '../../src/mcp/worker.ts';

async function connect(
  split: boolean,
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  queue = false,
) {
  const server = createWorkerServer({ token: 'token-1', split, queue, send });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { text: string }[])[0]?.text ?? '';
}

describe('worker MCP server', () => {
  it('forwards swarm_report with the attempt token', async () => {
    const calls: unknown[] = [];
    const client = await connect(false, async (method, params) => {
      calls.push({ method, params });
      return null;
    });
    const result = await client.callTool({
      name: 'swarm_report',
      arguments: { verdict: 'done', summary: 'готово' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('Recorded verdict done');
    expect(calls).toEqual([
      {
        method: 'report',
        params: {
          token: 'token-1',
          verdict: 'done',
          summary: 'готово',
          feedback: null,
          questions: null,
        },
      },
    ]);
  });

  it('forwards structured questions and rejects invalid ones', async () => {
    const calls: unknown[] = [];
    const client = await connect(false, async (method, params) => {
      calls.push({ method, params });
      return null;
    });
    const questions = [
      { text: 'OAuth или пароль?', options: ['OAuth', 'пароль'], recommendation: 'OAuth' },
    ];
    const result = await client.callTool({
      name: 'swarm_report',
      arguments: { verdict: 'needs_human', summary: 's', questions },
    });
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([
      {
        method: 'report',
        params: {
          token: 'token-1',
          verdict: 'needs_human',
          summary: 's',
          feedback: null,
          questions,
        },
      },
    ]);
    const tooMany = await client.callTool({
      name: 'swarm_report',
      arguments: {
        verdict: 'needs_human',
        summary: 's',
        questions: Array.from({ length: 11 }, () => ({ text: 'q' })),
      },
    });
    expect(tooMany.isError).toBe(true);
    const empty = await client.callTool({
      name: 'swarm_report',
      arguments: { verdict: 'needs_human', summary: 's', questions: [{ text: '' }] },
    });
    expect(empty.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('returns the daemon error to the specialist', async () => {
    const client = await connect(false, async () => {
      throw new Error('invalid report: feedback is required when verdict is rejected');
    });
    const result = await client.callTool({
      name: 'swarm_report',
      arguments: { verdict: 'rejected', summary: 's' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('feedback is required');
  });

  it('validates arguments before calling the daemon', async () => {
    const client = await connect(false, async () => null);
    const result = await client.callTool({
      name: 'swarm_report',
      arguments: { verdict: 'maybe', summary: '' },
    });
    expect(result.isError).toBe(true);
  });

  it('offers swarm_split only in the split step', async () => {
    const plain = await connect(false, async () => null);
    expect((await plain.listTools()).tools.map((tool) => tool.name)).toEqual(['swarm_report']);
    const calls: unknown[] = [];
    const splitting = await connect(true, async (method, params) => {
      calls.push({ method, params });
      return null;
    });
    expect((await splitting.listTools()).tools.map((tool) => tool.name)).toEqual([
      'swarm_report',
      'swarm_split',
    ]);
    const result = await splitting.callTool({
      name: 'swarm_split',
      arguments: { groups: [{ title: 'A', task: 'a' }] },
    });
    expect(textOf(result)).toContain('Recorded 1 group(s)');
    expect(calls).toEqual([
      { method: 'split', params: { token: 'token-1', groups: [{ title: 'A', task: 'a' }] } },
    ]);
  });

  it('offers swarm_queue_add only to a specialist allowed to queue', async () => {
    const without = await connect(false, async () => null);
    const names = (await without.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain('swarm_queue_add');
    const calls: unknown[] = [];
    const client = await connect(
      false,
      async (method, params) => {
        calls.push({ method, params });
        return { item: 'q-abc' };
      },
      true,
    );
    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toContain('swarm_queue_add');
    const add = tools.find((tool) => tool.name === 'swarm_queue_add');
    expect(Object.keys(add?.inputSchema.properties ?? {})).not.toContain('parent');
    const result = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'Реализовать web-i18n', title: 'web-i18n' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('q-abc');
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: {
          token: 'token-1',
          workflow: 'feature',
          task: 'Реализовать web-i18n',
          title: 'web-i18n',
        },
      },
    ]);
  });

  it('passes autoDeliver of a queued task from a specialist', async () => {
    const calls: unknown[] = [];
    const client = await connect(
      false,
      async (method, params) => {
        calls.push({ method, params });
        return { item: 'q-abc' };
      },
      true,
    );
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'x', autoDeliver: false },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', workflow: 'feature', task: 'x', autoDeliver: false },
      },
    ]);
  });

  it('passes deliveryMode of a queued task from a specialist', async () => {
    const calls: unknown[] = [];
    const client = await connect(
      false,
      async (method, params) => {
        calls.push({ method, params });
        return { item: 'q-abc' };
      },
      true,
    );
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'x', deliveryMode: 'branch' },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', workflow: 'feature', task: 'x', deliveryMode: 'branch' },
      },
    ]);
  });

  it('passes skip of a queued task from a specialist only when it is given', async () => {
    const calls: unknown[] = [];
    const client = await connect(
      false,
      async (method, params) => {
        calls.push({ method, params });
        return { item: 'q-abc' };
      },
      true,
    );
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'x', skip: ['review'] },
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'x' },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', workflow: 'feature', task: 'x', skip: ['review'] },
      },
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', workflow: 'feature', task: 'x' },
      },
    ]);
  });

  it('passes after of a queued task from a specialist only when it is given', async () => {
    const calls: unknown[] = [];
    const client = await connect(
      false,
      async (method, params) => {
        calls.push({ method, params });
        return { item: 'q-abc' };
      },
      true,
    );
    const result = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'API', after: ['q-prev'] },
    });
    expect(textOf(result)).toContain('q-abc');
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'x' },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', workflow: 'feature', task: 'API', after: ['q-prev'] },
      },
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', workflow: 'feature', task: 'x' },
      },
    ]);
    const tools = await client.listTools();
    const description = JSON.stringify(
      tools.tools.find((tool) => tool.name === 'swarm_queue_add')?.inputSchema,
    );
    expect(description).toContain('earlier swarm_queue_add');
  });

  it('returns a skip check error as a tool error', async () => {
    const client = await connect(
      false,
      async () => {
        throw new Error('unknown step `deploy` in skip; steps: code, review');
      },
      true,
    );
    const result = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'x', skip: ['deploy'] },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('unknown step `deploy` in skip');
  });

  it('refuses swarm_queue_add without a task or with both task and groups', async () => {
    const calls: unknown[] = [];
    const client = await connect(
      false,
      async (method) => {
        calls.push(method);
        return {};
      },
      true,
    );
    const neither = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature' },
    });
    expect(neither.isError).toBe(true);
    const both = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'a', groups: [{ title: 'b', task: 'c' }] },
    });
    expect(both.isError).toBe(true);
    expect(calls).toEqual([]);
  });
});
