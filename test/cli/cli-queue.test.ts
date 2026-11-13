import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

import { MANUAL_CONFIG } from '../daemon/harness.ts';
import { waitValue } from '../fixtures/wait-until.ts';
import { aip, main, sandbox, waitUntil } from './sandbox.ts';

describe('cli', () => {
  const fillQueue = async (box: ReturnType<typeof sandbox>) => {
    writeFileSync(
      join(box.repo, 'groups.yaml'),
      '- { title: Вход, task: форма }\n- { title: Выход, task: кнопка }\n',
    );
    await aip(box, 'queue', 'add', 'feature', '--task', 'первая задача');
    await aip(box, 'queue', 'add', 'feature', '--groups', 'groups.yaml', '--title', 'Две группы');
    await aip(box, 'queue', 'add', 'feature', '--task', 'третья');
    return JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
      items: { id: string; task: string | null }[];
    };
  };

  it('adds tasks to the queue and lists them', async () => {
    const box = sandbox();
    writeFileSync(
      join(box.repo, 'groups.yaml'),
      '- { title: Вход, task: форма }\n- { title: Выход, task: кнопка }\n',
    );
    const first = await aip(box, 'queue', 'add', 'feature', '--task', 'первая задача', '--json');
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ status: 'stopped', parallel: 1 });
    await aip(box, 'queue', 'add', 'feature', '--groups', 'groups.yaml', '--title', 'Две группы');
    const list = await aip(box, 'queue', 'list');
    expect(list.stdout).toContain('Queue: stopped, parallel 1');
    expect(list.stdout).toContain('1.');
    expect(list.stdout).toContain('первая задача');
    expect(list.stdout).toContain('2 groups');
  });

  it('links a task to a parent run with --parent and unlinks it with --no-parent', async () => {
    const box = sandbox();
    const view = await fillQueue(box);
    const started = await aip(box, 'queue', 'run', view.items[0]!.id);
    expect(started.stdout).toContain('started');
    const runs = JSON.parse((await aip(box, 'run', 'list', '--json')).stdout) as {
      id: string;
      number: number;
    }[];
    const parent = runs[0]!;
    const added = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'продолжение',
      '--parent',
      `#${parent.number}`,
      '--json',
    );
    expect(added.code).toBe(0);
    const item = (
      JSON.parse(added.stdout) as {
        items: { id: string; task: string | null; tags: { name: string; task: unknown }[] }[];
      }
    ).items.find((entry) => entry.task === 'продолжение')!;
    expect(item.tags).toHaveLength(1);
    expect(item.tags[0]!.task).toEqual({ run: parent.id, number: parent.number });
    const label = `#${item.tags[0]!.name}→#${parent.number}`;
    expect((await aip(box, 'queue', 'list')).stdout).toContain(label);
    const edited = await aip(box, 'queue', 'edit', item.id, '--parent', parent.id);
    expect(edited.stdout).toContain(label);
    const removed = await aip(box, 'queue', 'edit', item.id, '--no-parent');
    expect(removed.code).toBe(0);
    const line = removed.stdout.split('\n').find((row) => row.includes('продолжение'));
    expect(line).toBeDefined();
    expect(line).not.toContain('→');
  });

  it('refuses an unknown parent and --parent together with --no-parent', async () => {
    const box = sandbox();
    const view = await fillQueue(box);
    const unknown = await aip(box, 'queue', 'add', 'feature', '--task', 'x', '--parent', 'nope');
    expect(unknown.code).not.toBe(0);
    expect(`${unknown.stdout}${unknown.stderr}`).toContain('unknown parent `nope`');
    const start = await aip(box, 'run', 'start', 'feature', '--task', 'x', '--parent', '9999');
    expect(start.code).not.toBe(0);
    expect(`${start.stdout}${start.stderr}`).toContain('unknown parent `9999`');
    const both = await aip(box, 'queue', 'edit', view.items[0]!.id, '--parent', '1', '--no-parent');
    expect(both.code).not.toBe(0);
    expect(`${both.stdout}${both.stderr}`).toContain(
      '--no-parent cannot be combined with --parent',
    );
    expect((await aip(box, 'queue', 'list', '--json')).stdout).toContain(view.items[0]!.id);
  });

  it('moves, edits and removes queue items', async () => {
    const box = sandbox();
    const view = await fillQueue(box);
    const moved = await aip(box, 'queue', 'move', view.items[2]!.id, '1', '--json');
    expect((JSON.parse(moved.stdout) as typeof view).items.map((item) => item.task)).toEqual([
      'третья',
      'первая задача',
      null,
    ]);
    const edited = await aip(box, 'queue', 'edit', view.items[0]!.id, '--task', 'изменённая');
    expect(edited.stdout).toContain('изменённая');
    const removed = await aip(box, 'queue', 'remove', view.items[0]!.id, '--json');
    expect(JSON.parse(removed.stdout).items).toHaveLength(2);
  });

  it('refuses an unknown pipeline and both a task and groups', async () => {
    const box = sandbox();
    writeFileSync(join(box.repo, 'groups.yaml'), '- { title: Вход, task: форма }\n');
    const bad = await aip(box, 'queue', 'add', 'nope', '--task', 'x');
    expect(bad.code).not.toBe(0);
    expect(`${bad.stdout}${bad.stderr}`).toContain('unknown pipeline `nope`; known: feature');
    const both = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'x',
      '--groups',
      'groups.yaml',
    );
    expect(both.code).not.toBe(0);
  });

  it('runs an item now and pauses the queue', async () => {
    const box = sandbox();
    const view = await fillQueue(box);
    const now = await aip(box, 'queue', 'run', view.items[1]!.id);
    expect(now.stdout).toContain('started');
    const paused = await aip(box, 'queue', 'pause');
    expect(paused.stdout).toContain('Queue: stopped');
  });

  it('sets auto answer without touching autopilot', async () => {
    const box = sandbox();
    const on = await aip(box, 'queue', 'settings', '--auto-answer', 'on', '--json');
    expect(JSON.parse(on.stdout)).toMatchObject({ autoAnswer: true, autopilot: false });
    const wrong = await aip(box, 'queue', 'settings', '--auto-answer', 'yes');
    expect(wrong.code).toBe(1);
    expect(`${wrong.stdout}${wrong.stderr}`).toContain('--auto-answer must be on or off');
  });

  it('sets the autopilot from the terminal', async () => {
    const box = sandbox();
    const on = await aip(box, 'queue', 'settings', '--autopilot', 'on', '--json');
    expect(on.code).toBe(0);
    expect(JSON.parse(on.stdout)).toMatchObject({
      autopilot: true,
      skipFailed: false,
      parallel: 1,
      status: 'running',
    });
    const text = await aip(box, 'queue', 'settings', '--skip-failed', 'on', '--parallel', '2');
    expect(text.stdout).toContain('parallel 2');
    expect(text.stdout).toContain('autopilot on, auto answer off, skip failed on');
    const list = await aip(box, 'queue', 'list');
    expect(list.stdout).toContain('autopilot on, auto answer off, skip failed on');
    const off = await aip(box, 'queue', 'settings', '--autopilot', 'off', '--json');
    expect(JSON.parse(off.stdout)).toMatchObject({ autopilot: false, skipFailed: true });
  });

  it('refuses a wrong switch value and an empty call of queue settings', async () => {
    const box = sandbox();
    const wrong = await aip(box, 'queue', 'settings', '--autopilot', 'yes');
    expect(wrong.code).not.toBe(0);
    expect(`${wrong.stdout}${wrong.stderr}`).toContain('--autopilot must be on or off');
    const empty = await aip(box, 'queue', 'settings');
    expect(empty.code).not.toBe(0);
    expect(`${empty.stdout}${empty.stderr}`).toContain(
      'pass parallel, autopilot, autoAnswer, autopilotAnswer, skipFailed, onLimit or filter',
    );
    const view = await aip(box, 'queue', 'list', '--json');
    expect(JSON.parse(view.stdout)).toMatchObject({ autopilot: false, skipFailed: false });
  });

  it('sets the take filter from the terminal and clears one list', async () => {
    const box = sandbox();
    await aip(box, 'tag', 'add', 'auth');
    const set = await aip(
      box,
      'queue',
      'settings',
      '--filter-pipelines',
      'feature',
      '--filter-tags',
      'auth',
      '--json',
    );
    expect(set.code).toBe(0);
    const view = JSON.parse(set.stdout) as { filter: { pipelines: string[]; tags: string[] } };
    expect(view.filter.pipelines).toEqual(['feature']);
    expect(view.filter.tags).toHaveLength(1);
    const text = await aip(box, 'queue', 'list');
    expect(text.stdout).toContain('Filter: pipelines feature; tags auth');
    const cleared = await aip(box, 'queue', 'settings', '--filter-tags', '', '--json');
    expect(JSON.parse(cleared.stdout)).toMatchObject({
      filter: { pipelines: ['feature'], tags: [] },
    });
    const wrong = await aip(box, 'queue', 'settings', '--filter-pipelines', 'nope');
    expect(wrong.code).not.toBe(0);
    expect(`${wrong.stdout}${wrong.stderr}`).toContain('unknown pipeline `nope`');
  });

  it('sets the behaviour on a usage limit and refuses a wrong value', async () => {
    const box = sandbox();
    const wrong = await aip(box, 'queue', 'settings', '--on-limit', 'retry');
    expect(wrong.code).toBe(1);
    expect(`${wrong.stdout}${wrong.stderr}`).toContain('--on-limit must be wait or stop');
    const stop = await aip(box, 'queue', 'settings', '--on-limit', 'stop');
    expect(stop.code).toBe(0);
    expect(stop.stdout.split('\n')[0]).toMatch(/, on limit stop$/);
    const wait = await aip(box, 'queue', 'settings', '--on-limit', 'wait', '--json');
    expect(JSON.parse(wait.stdout)).toMatchObject({ onLimit: 'wait' });
  });

  it('returns a failed run to the queue', async () => {
    const box = sandbox();
    writeFileSync(
      join(box.repo, '..', 'script.json'),
      JSON.stringify({ code: [{ noReport: true }, {}] }),
    );
    expect((await aip(box, 'queue', 'add', 'feature', '--task', 'работа')).code).toBe(0);
    await aip(box, 'queue', 'start');
    const run = await waitValue('the queue to stop on a problem', async () => {
      const view = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
        stop: { kind: string; run?: string } | null;
      };
      return view.stop?.kind === 'problem' ? view.stop.run || null : null;
    });
    const returned = await aip(box, 'queue', 'return', run);
    expect(returned.code).toBe(0);
    expect(returned.stdout).toContain(`returns ${run}`);
    const listed = await aip(box, 'run', 'list');
    expect(listed.stdout).toContain('queued');
    expect(listed.stdout).toMatch(/queued\s+feature/);
    expect((await aip(box, 'run', 'show', run)).stdout).toContain('· queued ·');
    const json = JSON.parse((await aip(box, 'run', 'show', run, '--json')).stdout) as {
      run?: { state: string; queueItem: string | null };
      state?: string;
      queueItem?: string | null;
    };
    const shown = json.run ?? json;
    expect(shown.state).toBe('queued');
    expect(shown.queueItem).toEqual(expect.any(String));
    const again = await aip(box, 'queue', 'return', run);
    expect(again.code).toBe(1);
    expect(`${again.stdout}${again.stderr}`).toContain('run is already in the queue');
  });

  it('pauses a running run and refuses a finished one', async () => {
    const box = sandbox();
    const gate = join(box.repo, '..', 'gate');
    writeFileSync(
      join(box.repo, '..', 'script.json'),
      JSON.stringify({ code: [{ waitFor: gate }, { waitFor: gate }] }),
    );
    expect((await aip(box, 'queue', 'add', 'feature', '--task', 'работа')).code).toBe(0);
    expect((await aip(box, 'queue', 'add', 'feature', '--task', 'вторая')).code).toBe(0);
    await aip(box, 'queue', 'start');
    const run = await waitValue('a run in the queue', async () => {
      const view = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
        runs: { id: string }[];
      };
      return view.runs[0]?.id;
    });
    const paused = await aip(box, 'run', 'pause', run);
    expect(paused.code).toBe(0);
    expect(paused.stdout).toContain(`paused ${run}`);
    expect((await aip(box, 'run', 'list')).stdout).toMatch(/paused\s+feature/);
    const again = await aip(box, 'run', 'pause', run);
    expect(again.code).toBe(1);
    expect(`${again.stdout}${again.stderr}`).toContain('run is already paused');
    writeFileSync(gate, '');
  });

  it('refuses to pause a finished run', async () => {
    const box = sandbox();
    const started = JSON.parse(
      (await aip(box, 'run', 'start', 'feature', '--task', 'работа', '--json')).stdout,
    ) as { run: { runId: string } };
    const id = started.run.runId;
    await waitUntil('the run to finish', async () =>
      (await aip(box, 'run', 'show', id)).stdout.includes('· finished ·'),
    );
    const refused = await aip(box, 'run', 'pause', id);
    expect(refused.code).toBe(1);
    expect(`${refused.stdout}${refused.stderr}`).toContain('run has nothing to pause');
  });

  it('removes a skipped run from the skipped list', async () => {
    const box = sandbox();
    writeFileSync(
      join(box.repo, '..', 'script.json'),
      JSON.stringify({ code: [{ noReport: true }, {}] }),
    );
    await aip(box, 'queue', 'settings', '--skip-failed', 'on');
    expect((await aip(box, 'queue', 'add', 'feature', '--task', 'работа')).code).toBe(0);
    await aip(box, 'queue', 'start');
    const run = await waitValue('a skipped run', async () => {
      const view = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
        skipped: { id: string }[];
      };
      return view.skipped[0]?.id;
    });
    expect(run).not.toBe('');
    const dismissed = await aip(box, 'queue', 'dismiss', run, '--json');
    expect(dismissed.code).toBe(0);
    expect(JSON.parse(dismissed.stdout)).toMatchObject({ skipped: [] });
    const listed = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
      skipped: unknown[];
    };
    expect(listed.skipped).toEqual([]);
    const again = await aip(box, 'queue', 'dismiss', run);
    expect(again.code).toBe(1);
    expect(`${again.stdout}${again.stderr}`).toContain('run is not in the skipped list');
  });

  it('sets automatic delivery of a run and of queued tasks from flags', async () => {
    const box = sandbox();
    const run = JSON.parse(
      (await aip(box, 'run', 'start', 'feature', '--no-auto-deliver', '--task', 'x', '--json'))
        .stdout,
    ) as { run: { runId: string } };
    expect((await aip(box, 'run', 'show', run.run.runId)).stdout).toContain('manual delivery');
    const added = JSON.parse(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'a', '--no-auto-deliver', '--json'))
        .stdout,
    ) as { item: string; items: { autoDeliver: boolean | null }[] };
    expect(added.items[0]?.autoDeliver).toBe(false);
    await aip(box, 'queue', 'add', 'feature', '--task', 'b', '--auto-deliver');
    const waiting = JSON.parse(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'c', '--no-auto-deliver', '--json'))
        .stdout,
    ) as { item: string };
    expect((await aip(box, 'queue', 'list')).stdout).toMatch(/auto delivery[\s\S]*manual delivery/);
    const reset = JSON.parse(
      (await aip(box, 'queue', 'edit', waiting.item, '--default-auto-deliver', '--json')).stdout,
    ) as { items: { id: string; autoDeliver: boolean | null }[] };
    expect(reset.items.find((entry) => entry.id === waiting.item)?.autoDeliver).toBeNull();
    const both = await aip(
      box,
      'queue',
      'edit',
      waiting.item,
      '--auto-deliver',
      '--default-auto-deliver',
    );
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('--default-auto-deliver');
  });

  it('sets the delivery mode of queued tasks from flags and checks it before the call', async () => {
    const box = sandbox();
    const added = JSON.parse(
      (
        await aip(
          box,
          'queue',
          'add',
          'feature',
          '--task',
          'a',
          '--delivery-mode',
          'commit',
          '--json',
        )
      ).stdout,
    ) as { item: string; items: { deliveryMode: string | null }[] };
    expect(added.items[0]?.deliveryMode).toBe('commit');
    expect((await aip(box, 'queue', 'list')).stdout).toContain('delivery: commit');
    const wrong = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'b',
      '--delivery-mode',
      'tar',
    );
    expect(wrong.code).not.toBe(0);
    expect(wrong.stderr).toContain('--delivery-mode must be one of: worktree, commit, branch');
    const edited = JSON.parse(
      (await aip(box, 'queue', 'edit', added.item, '--delivery-mode', 'branch', '--json')).stdout,
    ) as { items: { deliveryMode: string | null }[] };
    expect(edited.items[0]?.deliveryMode).toBe('branch');
    const reset = JSON.parse(
      (await aip(box, 'queue', 'edit', added.item, '--default-delivery-mode', '--json')).stdout,
    ) as { items: { deliveryMode: string | null }[] };
    expect(reset.items[0]?.deliveryMode).toBeNull();
    const both = await aip(
      box,
      'queue',
      'edit',
      added.item,
      '--delivery-mode',
      'commit',
      '--default-delivery-mode',
    );
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('--default-delivery-mode');
    const run = JSON.parse(
      (
        await aip(
          box,
          'run',
          'start',
          'feature',
          '--delivery-mode',
          'branch',
          '--task',
          'x',
          '--json',
        )
      ).stdout,
    ) as { item: string };
    expect(run.item).toBeTruthy();
  });

  it('sets and resets the autopilot answer from flags', async () => {
    const box = sandbox();
    const set = JSON.parse(
      (await aip(box, 'queue', 'settings', '--autopilot-answer', 'Согласен', '--json')).stdout,
    ) as { autopilotAnswer: string | null };
    expect(set.autopilotAnswer).toBe('Согласен');
    expect((await aip(box, 'queue', 'list')).stdout).toContain('Autopilot answer: Согласен');
    const reset = JSON.parse(
      (await aip(box, 'queue', 'settings', '--default-autopilot-answer', '--json')).stdout,
    ) as { autopilotAnswer: string | null };
    expect(reset.autopilotAnswer).toBeNull();
    const both = await aip(
      box,
      'queue',
      'settings',
      '--autopilot-answer',
      'x',
      '--default-autopilot-answer',
    );
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('--default-autopilot-answer');
  });

  it('rejects a wrong parallel limit and starts the queue', async () => {
    const box = sandbox();
    await aip(box, 'queue', 'add', 'feature', '--task', 'первая');
    const wrong = await aip(box, 'queue', 'start', '--parallel', '0');
    expect(wrong.code).not.toBe(0);
    const started = await aip(box, 'queue', 'start', '--parallel', '2', '--json');
    expect(JSON.parse(started.stdout)).toMatchObject({ status: 'running', parallel: 2 });
  });

  it('changes parallel of a running queue at once and rejects 0', async () => {
    const box = sandbox();
    // Both runs stay in their step, so the places they hold do not depend on agent speed.
    writeFileSync(
      join(box.repo, '..', 'script.json'),
      JSON.stringify({ code: [{ waitFor: join(box.repo, '..', 'never') }] }),
    );
    await aip(box, 'queue', 'add', 'feature', '--task', 'первая');
    await aip(box, 'queue', 'start');
    await aip(box, 'queue', 'add', 'feature', '--task', 'вторая');
    const raised = await aip(box, 'queue', 'parallel', '2');
    expect(raised.code).toBe(0);
    expect(raised.stdout).toContain('parallel 2 (2 of 2 places taken)');
    const wrong = await aip(box, 'queue', 'parallel', '0');
    expect(wrong.code).not.toBe(0);
    const view = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
      parallel: number;
    };
    expect(view.parallel).toBe(2);
  });

  it('queues `run start` behind busy places and freezes the last run for a task started now', async () => {
    const box = sandbox();
    writeFileSync(box.env.AIP_FAKE_SCRIPT!, JSON.stringify({ code: [{ hang: true }] }));
    const first = await aip(box, 'run', 'start', 'feature', '--task', 'первая', '--json');
    expect(JSON.parse(first.stdout)).toMatchObject({ run: { runId: expect.any(String) } });
    const waiting = await aip(box, 'run', 'start', 'feature', '--task', 'вторая');
    expect(waiting.code).toBe(0);
    expect(waiting.stdout).toContain('queued at position 1');
    expect(waiting.stdout).toContain('1 of 1 places taken');
    const json = JSON.parse(
      (await aip(box, 'run', 'start', 'feature', '--task', 'третья', '--json')).stdout,
    ) as { item: string; run: unknown; queue: { items: unknown[] } };
    expect(json.run).toBeNull();
    expect(json.item).toMatch(/^q/);
    expect(json.queue.items).toHaveLength(2);
    const listed = await aip(box, 'queue', 'list');
    expect(listed.stdout).toMatch(/added \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    const now = await aip(box, 'queue', 'run', json.item);
    expect(now.code).toBe(0);
    expect(now.stdout).toContain('1 of 1 places taken');
    expect((await aip(box, 'queue', 'list')).stdout).toMatch(/frozen \w+/);
  });

  it('serves the host MCP tools over stdio', async () => {
    const box = sandbox(MANUAL_CONFIG);
    const client = new Client({ name: 'test-host', version: '0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [main, 'mcp'],
        cwd: box.repo,
        env: box.env as Record<string, string>,
      }),
    );
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toEqual([
      'swarm_answer',
      'swarm_apply',
      'swarm_cancel',
      'swarm_group',
      'swarm_mark_delivered',
      'swarm_queue',
      'swarm_queue_add',
      'swarm_queue_dismiss',
      'swarm_queue_edit',
      'swarm_queue_parallel',
      'swarm_queue_pause',
      'swarm_queue_remove',
      'swarm_queue_return',
      'swarm_queue_run_now',
      'swarm_queue_settings',
      'swarm_queue_start',
      'swarm_retry',
      'swarm_run',
      'swarm_run_pause',
      'swarm_skip_step',
      'swarm_status',
    ]);
    const added = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { pipeline: 'feature', task: 'Из Claude Code', title: 'Из очереди' },
    });
    expect((added.content as { text: string }[])[0]!.text).toMatch(/Added item q\w+/);
    const raised = await client.callTool({
      name: 'swarm_queue_parallel',
      arguments: { parallel: 3 },
    });
    expect((raised.content as { text: string }[])[0]!.text).toContain('parallel 3');
    const listed = await client.callTool({ name: 'swarm_queue', arguments: {} });
    expect((listed.content as { text: string }[])[0]!.text).toContain('Из очереди');
    const created = await client.callTool({
      name: 'swarm_run',
      arguments: { pipeline: 'feature', task: 'Сделать вход', title: 'Вход в систему' },
    });
    const text = (created.content as { text: string }[])[0]!.text;
    expect(text).toContain('started (refs/aip/');
    const runId = /Run #\d+ (\w+) started/.exec(text)?.[1] ?? '';
    const status = await client.callTool({ name: 'swarm_status', arguments: { run_id: runId } });
    expect((status.content as { text: string }[])[0]!.text).toMatch(
      new RegExp(`Run #\\d+ ${runId}`),
    );
    expect((status.content as { text: string }[])[0]!.text).toContain(
      'Title: Вход в систему (vhod-v-sistemu)',
    );
    expect((status.content as { text: string }[])[0]!.text).toContain('"topology"');
    expect((status.content as { text: string }[])[0]!.text).toContain('"onReject"');
    const wrong = await client.callTool({
      name: 'swarm_group',
      arguments: { run_id: runId, group: 'nope' },
    });
    await waitUntil('the run to finish', async () => {
      const status = await client.callTool({ name: 'swarm_status', arguments: { run_id: runId } });
      return (status.content as { text: string }[])[0]!.text.includes('· finished ·');
    });
    let changes = '';
    await waitUntil('the changes of the group', async () => {
      const group = await client.callTool({
        name: 'swarm_group',
        arguments: { run_id: runId, group: 'sdelat-vhod' },
      });
      changes = (group.content as { text: string }[])[0]!.text;
      return changes.includes('Changes:');
    });
    expect(changes).toMatch(/Changes: \d+ files? \+\d+ −\d+/);
    expect(changes).toContain('"diff"');
    const apply = await client.callTool({ name: 'swarm_apply', arguments: { run_id: runId } });
    expect(apply.isError).toBeFalsy();
    expect((apply.content as { text: string }[])[0]!.text).toContain(': applied');
    expect(wrong.isError).toBe(true);
    await client.close();
  });
});
