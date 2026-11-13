import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHostServer } from '../../src/presentation/mcp/host.ts';
import { groupView, runView } from '../../src/presentation/ipc/views/index.ts';
import type { QueueView } from '../../src/presentation/ipc/contract/index.ts';
import { run } from '../feature/runs/helpers.ts';

const VIEW: QueueView & { item: string } = {
  repository: '/repo',
  status: 'stopped',
  parallel: 1,
  autopilot: false,
  autoAnswer: false,
  skipFailed: false,
  autoDeliver: true,
  deliveryMode: 'worktree',
  autopilotAnswer: null,
  autopilotAnswerDefault: 'default',
  onLimit: 'wait',
  filter: { pipelines: [], tags: [] },
  filterTags: [],
  stop: null,
  freezeCandidate: null,
  items: [
    {
      id: 'q1',
      number: 1,
      position: 1,
      pipeline: 'feature',
      pipelineName: 'feature',
      task: 'Сделать вход',
      groups: null,
      title: null,
      autoDeliver: null,
      deliveryMode: null,
      tags: [],
      skip: [],
      readiness: 'ready',
      after: [],
      postponed: false,
      filtered: false,
      createdAt: 1,
      error: null,
      run: null,
      hold: null,
    },
  ],
  runs: [],
  skipped: [],
  updatedAt: 1,
  item: 'q1',
};

async function connect(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
) {
  const server = createHostServer({ send, cwd: '/repo' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>): string =>
  (result.content as { text: string }[])[0]?.text ?? '';

describe('host MCP parent of a task', () => {
  const LINKED = {
    id: 'tg1',
    repository: '/repo',
    name: 'cards-half-width',
    color: 'indigo' as const,
    task: { run: 'r115', number: 115 },
  };
  const WITH_PARENT: QueueView & { item: string } = {
    ...VIEW,
    items: [{ ...VIEW.items[0]!, tags: [LINKED] }],
  };

  it('passes parent of swarm_run, swarm_queue_add and swarm_queue_edit, also null', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return method === 'run' ? { item: 'q1', number: 1, run: null, queue: VIEW } : VIEW;
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x', parent: 115 },
    });
    await client.callTool({ name: 'swarm_queue_edit', arguments: { item: 'q1', parent: '#115' } });
    await client.callTool({ name: 'swarm_queue_edit', arguments: { item: 'q1', parent: null } });
    await client.callTool({
      name: 'swarm_run',
      arguments: { pipeline: 'feature', task: 'x', parent: 'r115' },
    });
    expect(calls).toEqual([
      {
        method: 'queue_add',
        params: { repository: '/repo', pipeline: 'feature', task: 'x', parent: 115 },
      },
      { method: 'queue_edit', params: { repository: '/repo', item: 'q1', parent: '#115' } },
      { method: 'queue_edit', params: { repository: '/repo', item: 'q1', parent: null } },
      {
        method: 'run',
        params: { repository: '/repo', pipeline: 'feature', task: 'x', parent: 'r115' },
      },
    ]);
  });

  it('shows where the linked task tag leads in the text and the JSON of swarm_queue', async () => {
    const client = await connect(async () => WITH_PARENT);
    const result = await client.callTool({ name: 'swarm_queue', arguments: {} });
    const text = textOf(result);
    expect(text).toContain('#cards-half-width→#115');
    expect(text).toContain('"task": {\n            "run": "r115",\n            "number": 115');
  });

  it('shows the same label in swarm_status', async () => {
    const view = { ...runView(run(1), 1000), tags: [LINKED] };
    const client = await connect(async () => [view]);
    const text = textOf(await client.callTool({ name: 'swarm_status', arguments: {} }));
    expect(text).toContain('#cards-half-width→#115');
    expect(text).toContain('"number": 115');
  });

  it('reports an unknown parent as a tool error', async () => {
    const client = await connect(async () => {
      throw new Error('unknown parent `nope`');
    });
    const result = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x', parent: 'nope' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('unknown parent `nope`');
  });
});

describe('host MCP swarm_mark_delivered', () => {
  const APPLIED = {
    runId: 'r1',
    pending: false,
    groups: [
      {
        slug: 'login',
        delivery: {
          state: 'applied',
          reason: null,
          files: [],
          conflicts: [],
          userEdits: [],
          manual: true,
          finishedAt: 1,
        },
      },
    ],
  };

  it('sends run_mark_delivered and prints the delivery as manual', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return APPLIED;
    });
    const result = await client.callTool({
      name: 'swarm_mark_delivered',
      arguments: { run_id: 'r1', groups: ['login'] },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('login: applied (manually)');
    expect(calls).toEqual([
      { method: 'run_mark_delivered', params: { runId: 'r1', groups: ['login'] } },
    ]);
  });

  it('reports a refusal as a tool error', async () => {
    const client = await connect(async () => {
      throw new Error('nothing to mark: no merged groups are waiting for delivery');
    });
    const result = await client.callTool({
      name: 'swarm_mark_delivered',
      arguments: { run_id: 'r1' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('nothing to mark');
  });
});

describe('host MCP queue tools', () => {
  it('lists the queue tools', async () => {
    const client = await connect(async () => VIEW);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of [
      'swarm_queue',
      'swarm_queue_add',
      'swarm_queue_edit',
      'swarm_queue_remove',
      'swarm_queue_start',
      'swarm_queue_parallel',
      'swarm_queue_settings',
      'swarm_queue_pause',
      'swarm_queue_run_now',
    ]) {
      expect(names).toContain(name);
    }
  });

  it('puts a task into the queue of the current directory', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    const result = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'Сделать вход' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('Added item q1.');
    expect(textOf(result)).toContain('1. #1 q1  feature  Сделать вход');
    expect(calls).toEqual([
      {
        method: 'queue_add',
        params: { repository: '/repo', pipeline: 'feature', task: 'Сделать вход' },
      },
    ]);
  });

  it('rejects the old workflow argument and adds no task', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    const result = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'x' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('pipeline');
    expect(calls).toEqual([]);
  });

  it('passes autoDeliver only when it is given', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x', autoDeliver: false },
    });
    await client.callTool({
      name: 'swarm_queue_edit',
      arguments: { item: 'q1', autoDeliver: null },
    });
    await client.callTool({
      name: 'swarm_run',
      arguments: { pipeline: 'feature', task: 'x', autoDeliver: true },
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'y' },
    });
    expect(calls).toEqual([
      {
        method: 'queue_add',
        params: { repository: '/repo', pipeline: 'feature', task: 'x', autoDeliver: false },
      },
      { method: 'queue_edit', params: { repository: '/repo', item: 'q1', autoDeliver: null } },
      {
        method: 'run',
        params: { repository: '/repo', pipeline: 'feature', task: 'x', autoDeliver: true },
      },
      { method: 'queue_add', params: { repository: '/repo', pipeline: 'feature', task: 'y' } },
    ]);
  });

  it('passes postponed only when it is given and shows it in the answer', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return {
        ...VIEW,
        items: [{ ...VIEW.items[0]!, postponed: params.postponed === true }],
      };
    });
    const edited = await client.callTool({
      name: 'swarm_queue_edit',
      arguments: { item: 'q1', postponed: true },
    });
    expect(textOf(edited)).toContain('postponed');
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'y', postponed: true },
    });
    await client.callTool({ name: 'swarm_queue_edit', arguments: { item: 'q1', title: 't' } });
    expect(calls).toEqual([
      { method: 'queue_edit', params: { repository: '/repo', item: 'q1', postponed: true } },
      {
        method: 'queue_add',
        params: { repository: '/repo', pipeline: 'feature', task: 'y', postponed: true },
      },
      { method: 'queue_edit', params: { repository: '/repo', item: 'q1', title: 't' } },
    ]);
  });

  it('passes deliveryMode only when it is given', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x', deliveryMode: 'commit' },
    });
    await client.callTool({
      name: 'swarm_queue_edit',
      arguments: { item: 'q1', deliveryMode: null },
    });
    await client.callTool({
      name: 'swarm_run',
      arguments: { pipeline: 'feature', task: 'x', deliveryMode: 'branch' },
    });
    const wrong = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x', deliveryMode: 'tar' },
    });
    expect(wrong.isError).toBe(true);
    expect(calls).toEqual([
      {
        method: 'queue_add',
        params: { repository: '/repo', pipeline: 'feature', task: 'x', deliveryMode: 'commit' },
      },
      { method: 'queue_edit', params: { repository: '/repo', item: 'q1', deliveryMode: null } },
      {
        method: 'run',
        params: { repository: '/repo', pipeline: 'feature', task: 'x', deliveryMode: 'branch' },
      },
    ]);
  });

  it('passes auto_answer of the queue settings', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    await client.callTool({ name: 'swarm_queue_settings', arguments: { auto_answer: true } });
    expect(calls).toEqual([
      { method: 'queue_settings', params: { repository: '/repo', autoAnswer: true } },
    ]);
  });

  it('passes the filter of the queue settings and shows it', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return { ...VIEW, filter: { pipelines: ['feature'], tags: [] } };
    });
    const result = await client.callTool({
      name: 'swarm_queue_settings',
      arguments: { filter: { pipelines: ['feature'] } },
    });
    expect(calls).toEqual([
      {
        method: 'queue_settings',
        params: { repository: '/repo', filter: { pipelines: ['feature'] } },
      },
    ]);
    expect(textOf(result)).toContain('Filter: pipelines feature');
  });

  it('returns the daemon error of a filter change in a running queue', async () => {
    const client = await connect(async () => {
      throw new Error('queue filter can be changed only while the queue is stopped');
    });
    const result = await client.callTool({
      name: 'swarm_queue_settings',
      arguments: { filter: { tags: ['auth'] } },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('queue filter can be changed only while the queue is stopped');
  });

  it('passes the autopilot answer of the queue settings', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    await client.callTool({
      name: 'swarm_queue_settings',
      arguments: { autopilot_answer: 'Согласен' },
    });
    await client.callTool({ name: 'swarm_queue_settings', arguments: { autopilot_answer: null } });
    expect(calls).toEqual([
      { method: 'queue_settings', params: { repository: '/repo', autopilotAnswer: 'Согласен' } },
      { method: 'queue_settings', params: { repository: '/repo', autopilotAnswer: null } },
    ]);
  });

  it('passes tag names to run, queue_add and queue_edit only when they are given', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x', tags: ['auth'] },
    });
    await client.callTool({ name: 'swarm_queue_edit', arguments: { item: 'q1', tags: [] } });
    await client.callTool({
      name: 'swarm_run',
      arguments: { pipeline: 'feature', task: 'x', tags: ['auth', 'v2'] },
    });
    await client.callTool({ name: 'swarm_queue_edit', arguments: { item: 'q1', title: 'T' } });
    expect(calls).toEqual([
      {
        method: 'queue_add',
        params: { repository: '/repo', pipeline: 'feature', task: 'x', tags: ['auth'] },
      },
      { method: 'queue_edit', params: { repository: '/repo', item: 'q1', tags: [] } },
      {
        method: 'run',
        params: { repository: '/repo', pipeline: 'feature', task: 'x', tags: ['auth', 'v2'] },
      },
      { method: 'queue_edit', params: { repository: '/repo', item: 'q1', title: 'T' } },
    ]);
  });

  it('passes skip to run, queue_add and queue_edit only when it is given', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x', skip: ['review', 'qa'] },
    });
    await client.callTool({ name: 'swarm_queue_edit', arguments: { item: 'q1', skip: [] } });
    await client.callTool({
      name: 'swarm_run',
      arguments: { pipeline: 'feature', task: 'x', skip: ['qa'] },
    });
    await client.callTool({ name: 'swarm_queue_edit', arguments: { item: 'q1', title: 'T' } });
    expect(calls).toEqual([
      {
        method: 'queue_add',
        params: { repository: '/repo', pipeline: 'feature', task: 'x', skip: ['review', 'qa'] },
      },
      { method: 'queue_edit', params: { repository: '/repo', item: 'q1', skip: [] } },
      {
        method: 'run',
        params: { repository: '/repo', pipeline: 'feature', task: 'x', skip: ['qa'] },
      },
      { method: 'queue_edit', params: { repository: '/repo', item: 'q1', title: 'T' } },
    ]);
  });

  it('chains tasks: passes after to run, queue_add and queue_edit only when it is given', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'API', after: ['q1'] },
    });
    await client.callTool({ name: 'swarm_queue_edit', arguments: { item: 'q2', after: [] } });
    await client.callTool({
      name: 'swarm_run',
      arguments: { pipeline: 'feature', task: 'UI', after: ['q1', 'r1'] },
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x' },
    });
    expect(calls).toEqual([
      {
        method: 'queue_add',
        params: { repository: '/repo', pipeline: 'feature', task: 'API', after: ['q1'] },
      },
      { method: 'queue_edit', params: { repository: '/repo', item: 'q2', after: [] } },
      {
        method: 'run',
        params: {
          repository: '/repo',
          pipeline: 'feature',
          task: 'UI',
          after: ['q1', 'r1'],
        },
      },
      { method: 'queue_add', params: { repository: '/repo', pipeline: 'feature', task: 'x' } },
    ]);
  });

  it('shows the readiness and the predecessors in swarm_queue', async () => {
    const waiting = {
      ...VIEW,
      items: [
        {
          ...VIEW.items[0]!,
          readiness: 'waiting' as const,
          after: [
            {
              kind: 'item' as const,
              id: 'q0',
              number: 5,
              title: 'модель',
              state: 'waiting' as const,
            },
          ],
        },
      ],
    };
    const client = await connect(async () => waiting);
    const result = await client.callTool({ name: 'swarm_queue', arguments: {} });
    expect(textOf(result)).toContain('after #5 q0 (waiting)');
    expect(JSON.stringify(result.content)).toContain('readiness');
  });

  it('shows the tags of a queued task and offers no tool for the catalog', async () => {
    const tagged = {
      ...VIEW,
      items: [{ ...VIEW.items[0]!, tags: [{ id: 'tg-a', name: 'auth', color: 'blue' as const }] }],
    };
    const client = await connect(async () => tagged);
    const result = await client.callTool({ name: 'swarm_queue', arguments: {} });
    expect(textOf(result)).toContain('#auth');
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names.filter((name) => name.includes('tag'))).toEqual([]);
  });

  it('passes the position, the repository and the parallel limit', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    await client.callTool({
      name: 'swarm_queue_edit',
      arguments: { item: 'q1', position: 2, repo: '/other' },
    });
    await client.callTool({ name: 'swarm_queue_start', arguments: { parallel: 2 } });
    await client.callTool({ name: 'swarm_queue_pause', arguments: {} });
    await client.callTool({ name: 'swarm_queue_remove', arguments: { item: 'q1' } });
    expect(calls).toEqual([
      { method: 'queue_edit', params: { repository: '/other', item: 'q1', position: 2 } },
      { method: 'queue_start', params: { repository: '/repo', parallel: 2 } },
      { method: 'queue_pause', params: { repository: '/repo' } },
      { method: 'queue_remove', params: { repository: '/repo', item: 'q1' } },
    ]);
  });

  it('changes parallel through queue_settings and returns the queue', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return { ...VIEW, parallel: 3 };
    });
    const result = await client.callTool({
      name: 'swarm_queue_parallel',
      arguments: { parallel: 3 },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('parallel 3');
    expect(calls).toEqual([
      { method: 'queue_settings', params: { repository: '/repo', parallel: 3 } },
    ]);
    const wrong = await client.callTool({
      name: 'swarm_queue_parallel',
      arguments: { parallel: 0 },
    });
    expect(wrong.isError).toBe(true);
  });

  it('turns on skipping of failed runs from Claude Code', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return { ...VIEW, skipFailed: true };
    });
    const result = await client.callTool({
      name: 'swarm_queue_settings',
      arguments: { skip_failed: true },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('skip failed on');
    expect(calls).toEqual([
      { method: 'queue_settings', params: { repository: '/repo', skipFailed: true } },
    ]);
  });

  it('sets the behaviour on a usage limit from Claude Code', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return { ...VIEW, onLimit: 'stop' };
    });
    const result = await client.callTool({
      name: 'swarm_queue_settings',
      arguments: { on_limit: 'stop' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('on limit stop');
    expect(calls).toEqual([
      { method: 'queue_settings', params: { repository: '/repo', onLimit: 'stop' } },
    ]);
  });

  it('removes a skipped run from the queue from Claude Code', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return VIEW;
    });
    const result = await client.callTool({
      name: 'swarm_queue_dismiss',
      arguments: { run_id: 'r1', repo: '/r' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('Dismissed r1.');
    expect(calls).toEqual([{ method: 'queue_dismiss', params: { runId: 'r1', repository: '/r' } }]);
  });

  it('returns a run to the queue from Claude Code', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return {
        ...VIEW,
        items: [{ ...VIEW.items[0]!, id: 'q9', run: 'r1' }],
        item: 'q9',
      };
    });
    const result = await client.callTool({
      name: 'swarm_queue_return',
      arguments: { run_id: 'r1' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('returns r1');
    expect(calls).toEqual([{ method: 'queue_return', params: { runId: 'r1' } }]);
  });

  it('pauses a run from Claude Code and returns a rule error as a tool error', async () => {
    const calls: unknown[] = [];
    let fail = false;
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      if (fail) throw new Error('run is already paused');
      return {
        ...VIEW,
        items: [{ ...VIEW.items[0]!, id: 'q9', run: 'A', hold: 'paused' }],
        item: 'q9',
      };
    });
    const result = await client.callTool({ name: 'swarm_run_pause', arguments: { run_id: 'A' } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('paused A');
    expect(calls).toEqual([{ method: 'run_pause', params: { runId: 'A' } }]);
    fail = true;
    const refused = await client.callTool({ name: 'swarm_run_pause', arguments: { run_id: 'A' } });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('run is already paused');
  });

  it('returns the daemon error of an empty settings call', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      throw new Error(
        'pass parallel, autopilot, autoAnswer, autopilotAnswer, skipFailed, onLimit or filter',
      );
    });
    const result = await client.callTool({ name: 'swarm_queue_settings', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      'pass parallel, autopilot, autoAnswer, autopilotAnswer, skipFailed, onLimit or filter',
    );
    expect(calls).toEqual([{ method: 'queue_settings', params: { repository: '/repo' } }]);
  });

  it('returns a skip check error as a tool error', async () => {
    const client = await connect(async () => {
      throw new Error('unknown step `deploy` in skip; steps: code, review');
    });
    for (const [name, args] of [
      ['swarm_queue_add', { pipeline: 'feature', task: 'x', skip: ['deploy'] }],
      ['swarm_queue_edit', { item: 'q1', skip: ['deploy'] }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('unknown step `deploy` in skip');
    }
  });

  it('returns the run and the daemon errors', async () => {
    const client = await connect(async (method) => {
      if (method === 'queue_run_now') {
        return {
          runId: 'r1',
          number: 1,
          branch: 'refs/aip/r1/run',
          groups: [],
          split: true,
          warnings: [],
        };
      }
      throw new Error('unknown queue item');
    });
    const run = await client.callTool({ name: 'swarm_queue_run_now', arguments: { item: 'q1' } });
    expect(textOf(run)).toContain('Run #1 r1 started');
    const failed = await client.callTool({ name: 'swarm_queue', arguments: {} });
    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toContain('unknown queue item');
  });

  it('queues a task with swarm_run and shows whether the run exists', async () => {
    const created = {
      runId: 'r1',
      number: 1,
      branch: 'refs/aip/r1/run',
      groups: [],
      split: true,
      warnings: [],
    };
    const sent: string[] = [];
    let answer: unknown = { item: 'q1', number: 1, run: created, queue: VIEW };
    const client = await connect(async (method) => {
      sent.push(method);
      return answer;
    });
    const started = await client.callTool({
      name: 'swarm_run',
      arguments: { pipeline: 'feature', task: 'x' },
    });
    expect(sent).toEqual(['run']);
    expect(textOf(started)).toContain('Run #1 r1 started');
    answer = { item: 'q1', number: 1, run: null, queue: { ...VIEW, status: 'running' } };
    const waiting = await client.callTool({
      name: 'swarm_run',
      arguments: { pipeline: 'feature', task: 'x' },
    });
    expect(textOf(waiting)).toContain(
      'Task #1 q1 queued at position 1 (queue running, 0 of 1 places taken).',
    );
    expect(textOf(waiting)).toContain('"run": null');
  });
});

describe('host MCP texts', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('stay plain under FORCE_COLOR=1', async () => {
    vi.stubEnv('FORCE_COLOR', '1');
    const state = run(1);
    state.groups[0]!.status = 'failed';
    const runs = runView(state, 2000);
    const group = groupView(state, state.groups[0]!, '/w', null, 2000);
    const client = await connect(async (method, params) =>
      method === 'group' ? group : (params as { runId?: string }).runId ? runs : [runs],
    );
    for (const [name, args] of [
      ['swarm_status', {}],
      ['swarm_status', { run_id: runs.id }],
      ['swarm_group', { run_id: runs.id, group: group.slug }],
    ] as const) {
      const text = textOf(await client.callTool({ name, arguments: args }));
      expect(text, name).toContain('failed');
      expect(text, name).not.toContain('\x1b[');
      expect(text, name).not.toMatch(/[✓✗?▸◦⊘] /);
    }
  });
});

describe('host MCP swarm_skip_step', () => {
  it('sends run_skip, skipping by default and bringing back with skip=false', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return runView(run(1), 1000);
    });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('swarm_skip_step');
    const skipped = await client.callTool({
      name: 'swarm_skip_step',
      arguments: { run_id: 'run000000001', step: 'qa' },
    });
    expect(skipped.isError).toBeFalsy();
    await client.callTool({
      name: 'swarm_skip_step',
      arguments: { run_id: 'run000000001', step: 'qa', skip: false },
    });
    expect(calls).toEqual([
      { method: 'run_skip', params: { runId: 'run000000001', step: 'qa', skip: true } },
      { method: 'run_skip', params: { runId: 'run000000001', step: 'qa', skip: false } },
    ]);
  });

  it('tells that a humanOnly question is answered only with the words of the user', async () => {
    const client = await connect(async () => VIEW);
    const tools = (await client.listTools()).tools;
    expect(tools.find((tool) => tool.name === 'swarm_answer')?.description).toContain('humanOnly');
  });

  it('describes the freezing of the last run in the tools that take a place', async () => {
    const client = await connect(async () => VIEW);
    const tools = (await client.listTools()).tools;
    for (const name of ['swarm_queue_run_now', 'swarm_queue_return', 'swarm_retry']) {
      expect(tools.find((tool) => tool.name === name)?.description).toContain('frozen');
    }
  });

  it('sends refreshConfig of swarm_retry only when it is given', async () => {
    const calls: unknown[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return runView(run(1), 1000);
    });
    await client.callTool({
      name: 'swarm_retry',
      arguments: { run_id: 'run000000001', group: 'gruppa-1' },
    });
    const refreshed = await client.callTool({
      name: 'swarm_retry',
      arguments: { run_id: 'run000000001', group: 'gruppa-1', refresh_config: true },
    });
    expect(refreshed.isError).toBeFalsy();
    expect(calls).toEqual([
      { method: 'retry', params: { runId: 'run000000001', group: 'gruppa-1' } },
      {
        method: 'retry',
        params: { runId: 'run000000001', group: 'gruppa-1', refreshConfig: true },
      },
    ]);
  });

  it('reports a refusal of the daemon as a tool error', async () => {
    const client = await connect(async () => {
      throw new Error('step `plan` is already passed by every group');
    });
    const result = await client.callTool({
      name: 'swarm_skip_step',
      arguments: { run_id: 'run000000001', step: 'plan' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('already passed');
  });
});

describe('host MCP repo as a project slug', () => {
  it('sends a slug as it is and a path resolved against the working directory', async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const client = await connect(async (method, params) => {
      calls.push({ method, params });
      return method === 'run' ? { item: 'q1', number: 1, run: null, queue: VIEW } : VIEW;
    });
    await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'x', repo: 'app' },
    });
    await client.callTool({ name: 'swarm_queue', arguments: { repo: 'sub/dir' } });
    await client.callTool({
      name: 'swarm_run',
      arguments: { pipeline: 'feature', task: 'x', repo: 'shop' },
    });
    expect(calls.map((call) => call.params.repository)).toEqual(['app', '/repo/sub/dir', 'shop']);
  });
});
