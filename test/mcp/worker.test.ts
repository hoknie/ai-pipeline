import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { DUPLICATE_TASK_CODE } from '../../src/feature/queue/types/index.ts';
import { IpcError } from '../../src/presentation/ipc/client/index.ts';
import { createWorkerServer } from '../../src/presentation/mcp/worker.ts';

async function connect(
  split: boolean,
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  queue = false,
  repair = false,
) {
  const server = createWorkerServer({ token: 'token-1', split, queue, repair, send });
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
      arguments: { verdict: 'done', summary: 'done' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('Recorded verdict done');
    expect(calls).toEqual([
      {
        method: 'report',
        params: {
          token: 'token-1',
          verdict: 'done',
          summary: 'done',
          feedback: null,
          questions: null,
          human_only: null,
        },
      },
    ]);
  });

  it('forwards human_only and lists it in the tool schema', async () => {
    const calls: { params: Record<string, unknown> }[] = [];
    const client = await connect(false, async (_method, params) => {
      calls.push({ params });
      return null;
    });
    const tool = (await client.listTools()).tools.find((item) => item.name === 'swarm_report');
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toContain('human_only');
    await client.callTool({
      name: 'swarm_report',
      arguments: {
        verdict: 'needs_human',
        summary: 's',
        feedback: 'Take a look',
        human_only: true,
      },
    });
    expect(calls[0]?.params.human_only).toBe(true);
  });

  it('forwards structured questions and rejects invalid ones', async () => {
    const calls: unknown[] = [];
    const client = await connect(false, async (method, params) => {
      calls.push({ method, params });
      return null;
    });
    const questions = [
      { text: 'OAuth or password?', options: ['OAuth', 'password'], recommendation: 'OAuth' },
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
          human_only: null,
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
    expect((await plain.listTools()).tools.map((tool) => tool.name)).toEqual([
      'swarm_report',
      'swarm_artifact',
      'swarm_run_show',
    ]);
    const calls: unknown[] = [];
    const splitting = await connect(true, async (method, params) => {
      calls.push({ method, params });
      return null;
    });
    expect((await splitting.listTools()).tools.map((tool) => tool.name)).toEqual([
      'swarm_report',
      'swarm_artifact',
      'swarm_run_show',
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

  it('swarm_run_show passes the reference with the attempt token and shows the daemon error', async () => {
    const calls: unknown[] = [];
    const client = await connect(false, async (method, params) => {
      calls.push({ method, params });
      throw new Error('run abc belongs to another repository');
    });
    const result = await client.callTool({
      name: 'swarm_run_show',
      arguments: { run: 'http://127.0.0.1:7341/#runs/abc/fix', group: 'login', tail_lines: 5 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('run abc belongs to another repository');
    await client.callTool({ name: 'swarm_run_show', arguments: { run: '#333' } });
    expect(calls).toEqual([
      {
        method: 'worker_run_show',
        params: {
          token: 'token-1',
          run: 'http://127.0.0.1:7341/#runs/abc/fix',
          group: 'login',
          tailLines: 5,
        },
      },
      { method: 'worker_run_show', params: { token: 'token-1', run: '#333' } },
    ]);
    const refused = await client.callTool({
      name: 'swarm_run_show',
      arguments: { run: 'abc', tail_lines: 0 },
    });
    expect(refused.isError).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('swarm_artifact sends content or a path and answers with the id', async () => {
    const calls: unknown[] = [];
    const client = await connect(false, async (method, params) => {
      calls.push({ method, params });
      return { id: 'a-1' };
    });
    const content = await client.callTool({
      name: 'swarm_artifact',
      arguments: { file_name: 'report.md', title: 'Summary', content: '# hi' },
    });
    expect(content.isError).toBeFalsy();
    expect(textOf(content)).toContain('Recorded artifact a-1 (report.md)');
    const path = await client.callTool({
      name: 'swarm_artifact',
      arguments: { file_name: 'build.log', path: 'tmp/build.log' },
    });
    expect(path.isError).toBeFalsy();
    expect(calls).toEqual([
      {
        method: 'artifact_publish',
        params: { token: 'token-1', fileName: 'report.md', title: 'Summary', content: '# hi' },
      },
      {
        method: 'artifact_publish',
        params: { token: 'token-1', fileName: 'build.log', path: 'tmp/build.log' },
      },
    ]);
  });

  it('swarm_artifact refuses a wrong call before it reaches the daemon', async () => {
    const calls: unknown[] = [];
    const client = await connect(false, async (method) => {
      calls.push(method);
      return { id: 'x' };
    });
    const bad: Record<string, unknown>[] = [
      { file_name: 'a.md' },
      { file_name: 'a.md', content: 'x', path: 'a.md' },
      { file_name: '../a.md', content: 'x' },
      { file_name: 'a/b.md', content: 'x' },
      { file_name: 'a.md', content: 'x'.repeat(1024 * 1024 + 1) },
    ];
    for (const args of bad) {
      let refused = false;
      try {
        refused =
          (await client.callTool({ name: 'swarm_artifact', arguments: args })).isError === true;
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
    }
    expect(calls).toEqual([]);
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
    expect(Object.keys(add?.inputSchema.properties ?? {})).not.toContain('attachments');
    const result = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'Implement web-i18n', title: 'web-i18n' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('q-abc');
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: {
          token: 'token-1',
          pipeline: 'feature',
          task: 'Implement web-i18n',
          title: 'web-i18n',
        },
      },
    ]);
  });

  it('offers swarm_queue_edit and swarm_queue_remove only with the right to queue', async () => {
    const without = await connect(false, async () => null);
    const names = (await without.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain('swarm_queue_edit');
    expect(names).not.toContain('swarm_queue_remove');
    const client = await connect(false, async () => null, true);
    const tools = (await client.listTools()).tools;
    const edit = tools.find((tool) => tool.name === 'swarm_queue_edit');
    const remove = tools.find((tool) => tool.name === 'swarm_queue_remove');
    expect(Object.keys(edit?.inputSchema.properties ?? {}).sort()).toEqual(
      [
        'item',
        'pipeline',
        'variant',
        'provider',
        'task',
        'groups',
        'title',
        'autoDeliver',
        'deliveryMode',
        'deliveryBranch',
        'skip',
        'after',
        'links',
      ].sort(),
    );
    expect(Object.keys(remove?.inputSchema.properties ?? {})).toEqual(['item']);
    const add = tools.find((tool) => tool.name === 'swarm_queue_add');
    expect(add?.description).toContain('swarm_queue_edit');
    expect(add?.description).toContain('swarm_queue_remove');
    expect(Object.keys(add?.inputSchema.properties ?? {})).not.toContain('allowDuplicate');
  });

  it('changes and removes a task of the run and names it in the answer', async () => {
    const calls: unknown[] = [];
    const client = await connect(
      false,
      async (method, params) => {
        calls.push({ method, params });
        return { item: 'q3' };
      },
      true,
    );
    const edited = await client.callTool({
      name: 'swarm_queue_edit',
      arguments: { item: 'q3', after: ['q2'], title: null },
    });
    expect(edited.isError).toBeFalsy();
    expect(textOf(edited)).toContain('Changed q3');
    const removed = await client.callTool({
      name: 'swarm_queue_remove',
      arguments: { item: 'q3' },
    });
    expect(removed.isError).toBeFalsy();
    expect(textOf(removed)).toContain('Removed q3');
    expect(calls).toEqual([
      {
        method: 'worker_queue_edit',
        params: { token: 'token-1', item: 'q3', after: ['q2'], title: null },
      },
      { method: 'worker_queue_remove', params: { token: 'token-1', item: 'q3' } },
    ]);
  });

  it('refuses a change without a field or with both a task and groups, and passes a refusal of the queue', async () => {
    const calls: unknown[] = [];
    const client = await connect(
      false,
      async (method, params) => {
        calls.push({ method, params });
        throw new Error('task q9 was not queued by this run');
      },
      true,
    );
    const empty = await client.callTool({ name: 'swarm_queue_edit', arguments: { item: 'q3' } });
    expect(empty.isError).toBe(true);
    expect(textOf(empty)).toContain('pass at least one field to change');
    const both = await client.callTool({
      name: 'swarm_queue_edit',
      arguments: { item: 'q3', task: 'a', groups: [{ title: 'g', task: 't' }] },
    });
    expect(both.isError).toBe(true);
    expect(textOf(both)).toContain('pass either task or groups');
    expect(calls).toEqual([]);
    const foreign = await client.callTool({
      name: 'swarm_queue_remove',
      arguments: { item: 'q9' },
    });
    expect(foreign.isError).toBe(true);
    expect(textOf(foreign)).toBe('task q9 was not queued by this run');
  });

  it('tells a specialist to change or remove the waiting task when its copy is refused', async () => {
    const client = await connect(
      false,
      async () => {
        throw new IpcError(
          'task #12 (q1) with the same pipeline and task already waits in the queue',
          { code: DUPLICATE_TASK_CODE },
        );
      },
      true,
    );
    const refused = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'Implement web-i18n', after: ['q0'] },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('task #12 (q1)');
    expect(textOf(refused)).toContain('swarm_queue_edit');
    expect(textOf(refused)).toContain('swarm_queue_remove');
  });

  it('passes links of a queued task from a specialist and offers no parent', async () => {
    const calls: unknown[] = [];
    const client = await connect(
      false,
      async (method, params) => {
        calls.push({ method, params });
        return { item: 'q-abc' };
      },
      true,
    );
    const add = (await client.listTools()).tools.find((tool) => tool.name === 'swarm_queue_add');
    expect(Object.keys(add?.inputSchema.properties ?? {})).toContain('links');
    expect(Object.keys(add?.inputSchema.properties ?? {})).not.toContain('parent');
    const links = [{ kind: 'related', target: 'r1' }];
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x', links },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', pipeline: 'feature', task: 'x', links },
      },
    ]);
  });

  it('passes variant of a queued task from a specialist', async () => {
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
      arguments: { pipeline: 'feature', task: 'x', variant: 'light' },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', pipeline: 'feature', variant: 'light', task: 'x' },
      },
    ]);
  });

  it('passes the provider a specialist names and never inherits the one of its run', async () => {
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
      arguments: { pipeline: 'feature', task: 'x' },
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x', provider: 'zai' },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', pipeline: 'feature', task: 'x' },
      },
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', pipeline: 'feature', task: 'x', provider: 'zai' },
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
      arguments: { pipeline: 'feature', task: 'x', autoDeliver: false },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', pipeline: 'feature', task: 'x', autoDeliver: false },
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
      arguments: { pipeline: 'feature', task: 'x', deliveryMode: 'branch' },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', pipeline: 'feature', task: 'x', deliveryMode: 'branch' },
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
      arguments: { pipeline: 'feature', task: 'x', skip: ['review'] },
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x' },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', pipeline: 'feature', task: 'x', skip: ['review'] },
      },
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', pipeline: 'feature', task: 'x' },
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
      arguments: { pipeline: 'feature', task: 'API', after: ['q-prev'] },
    });
    expect(textOf(result)).toContain('q-abc');
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x' },
    });
    expect(calls).toEqual([
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', pipeline: 'feature', task: 'API', after: ['q-prev'] },
      },
      {
        method: 'worker_queue_add',
        params: { token: 'token-1', pipeline: 'feature', task: 'x' },
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
      arguments: { pipeline: 'feature', task: 'x', skip: ['deploy'] },
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
      arguments: { pipeline: 'feature' },
    });
    expect(neither.isError).toBe(true);
    const both = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'a', groups: [{ title: 'b', task: 'c' }] },
    });
    expect(both.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it('offers swarm_repair_* only with the repair option', async () => {
    const names = async (repair: boolean) =>
      (await (await connect(false, async () => null, false, repair)).listTools()).tools
        .map((tool) => tool.name)
        .sort();
    expect(await names(false)).toEqual(['swarm_artifact', 'swarm_report', 'swarm_run_show']);
    expect(await names(true)).toEqual([
      'swarm_artifact',
      'swarm_repair_answer',
      'swarm_repair_cancel',
      'swarm_repair_retry',
      'swarm_report',
      'swarm_run_show',
    ]);
  });

  it('forwards the repair actions with the token', async () => {
    const calls: unknown[] = [];
    const client = await connect(
      false,
      async (method, params) => {
        calls.push({ method, params });
        return null;
      },
      false,
      true,
    );
    expect(
      (
        await client.callTool({
          name: 'swarm_repair_answer',
          arguments: { group: 'g1', answer: '  yes ' },
        })
      ).isError,
    ).toBeFalsy();
    await client.callTool({
      name: 'swarm_repair_retry',
      arguments: { group: 'g1', refresh_config: true },
    });
    await client.callTool({ name: 'swarm_repair_retry', arguments: { group: 'g2' } });
    await client.callTool({
      name: 'swarm_repair_cancel',
      arguments: { group: 'g1', reason: 'broken' },
    });
    await client.callTool({ name: 'swarm_repair_cancel', arguments: { reason: 'all' } });
    const invalid = await client.callTool({
      name: 'swarm_repair_cancel',
      arguments: { reason: '   ' },
    });
    expect(invalid.isError).toBe(true);
    expect(calls).toEqual([
      {
        method: 'repair_action',
        params: { action: 'answer', token: 'token-1', group: 'g1', answer: 'yes' },
      },
      {
        method: 'repair_action',
        params: { action: 'retry', token: 'token-1', group: 'g1', refreshConfig: true },
      },
      { method: 'repair_action', params: { action: 'retry', token: 'token-1', group: 'g2' } },
      {
        method: 'repair_action',
        params: { action: 'cancel', token: 'token-1', group: 'g1', reason: 'broken' },
      },
      { method: 'repair_action', params: { action: 'cancel', token: 'token-1', reason: 'all' } },
    ]);
  });

  it('returns a daemon error of a repair action as a tool error', async () => {
    const client = await connect(
      false,
      async () => {
        throw new Error('token is not an observer');
      },
      false,
      true,
    );
    const result = await client.callTool({
      name: 'swarm_repair_retry',
      arguments: { group: 'g1' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('token is not an observer');
  });
});
