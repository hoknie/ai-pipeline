import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { QueueView, RunCreated } from '../../src/protocol/index.ts';

import { WORKFLOW_CONFIG, startRun, type Harness } from './harness.ts';
import { queueOf, start } from './queue-harness.ts';

// Every test here sends its requests through the real worker MCP server (`aip mcp --worker`)
// with `realWorker: true`; the other daemon tests send the same requests straight to the socket.

const SPLIT_CONFIG = WORKFLOW_CONFIG.replace(
  '    feature:\n      steps:',
  '    feature:\n      split: { specialist: coder, max_groups: 3 }\n      steps:',
);
const QUEUE_CONFIG = WORKFLOW_CONFIG.replace(
  'coder: { name: Кодировщик }',
  'coder: { name: Кодировщик, queue: true }',
);

interface ToolResult {
  step: string;
  name: string;
  result: { isError?: boolean; content: { text: string }[] };
}

function toolResults(h: Harness): ToolResult[] {
  return readFileSync(join(h.fakeState, 'tools.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ToolResult);
}

function workers(h: Harness): { step: string; group: string; via: string }[] {
  return readFileSync(join(h.fakeState, 'worker.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { step: string; group: string; via: string });
}

const textOf = (entry: ToolResult | undefined) => entry?.result.content[0]?.text ?? '';

describe('the worker MCP server through a real agent', () => {
  it('is only used when the agent asks for it', async () => {
    const h = await start();
    h.script({ code: [{ realWorker: true }], review: [{}] });
    const created = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'Логин', task: 'логин' }],
    })) as RunCreated;
    await h.waitFor(created.runId, (view) => view.finished);
    expect(workers(h)).toEqual([
      { step: 'code', group: 'Логин', via: 'mcp' },
      { step: 'review', group: 'Логин', via: 'direct' },
    ]);
  });

  it('swarm_split: the groups reach the daemon and the answer counts them', async () => {
    const h = await start(SPLIT_CONFIG);
    h.script({
      split: [
        {
          realWorker: true,
          toolCalls: [
            {
              name: 'swarm_split',
              arguments: { groups: [{ title: 'Вход', task: 'вход' }] },
            },
          ],
          split: [
            { title: 'Вход', task: 'вход' },
            { title: 'Выход', task: 'выход' },
          ],
        },
      ],
    });
    const created = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      task: 'вход и выход',
    })) as RunCreated;
    const final = await h.waitFor(created.runId, (view) => view.finished);
    // the second call replaced the first proposal
    expect(final.groups.map((group) => group.slug)).toEqual(['vhod', 'vyhod']);
    expect(textOf(toolResults(h)[0])).toBe(
      'Recorded 1 group(s). Call swarm_report when you are done.',
    );
  });

  it('swarm_split: refuses an empty list of groups', async () => {
    const h = await start(SPLIT_CONFIG);
    h.script({
      split: [
        {
          realWorker: true,
          toolCalls: [{ name: 'swarm_split', arguments: { groups: [] } }],
          split: [{ title: 'Вход', task: 'вход' }],
        },
      ],
    });
    const created = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      task: 'вход',
    })) as RunCreated;
    await h.waitFor(created.runId, (view) => view.finished);
    const [refused] = toolResults(h);
    expect(refused?.result.isError).toBe(true);
    expect(textOf(refused)).toMatch(/groups/);
  });

  it('swarm_queue_add: a task and groups reach the queue of the repository', async () => {
    const h = await start(QUEUE_CONFIG);
    h.script({
      code: [
        {
          realWorker: true,
          toolCalls: [
            { name: 'swarm_queue_add', arguments: { workflow: 'feature', task: 'первая' } },
            {
              name: 'swarm_queue_add',
              arguments: {
                workflow: 'feature',
                groups: [{ title: 'Часть', task: 'часть' }],
                title: 'Вторая',
              },
            },
          ],
        },
      ],
    });
    const created = await startRun(h, { repository: h.repo, workflow: 'feature', task: 'итоги' });
    await h.call('queue_pause', { repository: h.repo });
    await h.waitFor(created.runId, (view) => view.finished);
    const results = toolResults(h);
    expect(results.map((entry) => entry.result.isError)).toEqual([undefined, undefined]);
    expect(textOf(results[0])).toMatch(/^Queued \S+ for workflow feature\. It starts when/);
    const queue: QueueView = await queueOf(h);
    expect(queue.items.map((item) => item.title)).toEqual([null, 'Вторая']);
  });

  it('swarm_queue_add: refuses both a task and groups, and neither', async () => {
    const h = await start(QUEUE_CONFIG);
    h.script({
      code: [
        {
          realWorker: true,
          toolCalls: [
            {
              name: 'swarm_queue_add',
              arguments: {
                workflow: 'feature',
                task: 'задача',
                groups: [{ title: 'Часть', task: 'часть' }],
              },
            },
            { name: 'swarm_queue_add', arguments: { workflow: 'feature' } },
          ],
        },
      ],
    });
    const created = await startRun(h, { repository: h.repo, workflow: 'feature', task: 'итоги' });
    await h.call('queue_pause', { repository: h.repo });
    await h.waitFor(created.runId, (view) => view.finished);
    const results = toolResults(h);
    expect(results.map((entry) => entry.result.isError)).toEqual([true, true]);
    expect(results.map(textOf)).toEqual([
      'pass either task or groups',
      'pass either task or groups',
    ]);
    expect((await queueOf(h)).items).toHaveLength(0);
  });

  it('swarm_queue_add: orders a task after the ids of earlier answers', async () => {
    const h = await start(QUEUE_CONFIG);
    h.script({
      code: [
        {
          realWorker: true,
          queueChain: [
            { workflow: 'feature', task: 'первая', title: 'Первая' },
            { workflow: 'feature', task: 'вторая', title: 'Вторая', after: ['$prev'] },
          ],
        },
      ],
    });
    const created = await startRun(h, { repository: h.repo, workflow: 'feature', task: 'итоги' });
    await h.call('queue_pause', { repository: h.repo });
    await h.waitFor(created.runId, (view) => view.finished);
    const queue = await queueOf(h);
    const [first, second] = queue.items;
    expect(first?.title).toBe('Первая');
    expect(second?.title).toBe('Вторая');
    expect(second?.after.map((dependency) => dependency.id)).toEqual([first?.id]);
  });
});
