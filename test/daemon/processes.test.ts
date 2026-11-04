import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseClock,
  parsePs,
  selectBackground,
  snapshotProcesses,
  terminateTree,
  type AgentRoot,
  type PsRow,
} from '../../src/daemon/processes.ts';
import {
  streamEventSchema,
  subscribe,
  type BackgroundProcessesView,
  type StreamEvent,
} from '../../src/protocol/index.ts';
import { alive, run, start } from './control-harness.ts';
import { harness, until, type Harness } from './harness.ts';

const MAC = `  100     1   100     05:10   0:01.50  20480 /usr/local/bin/claude --print
  101   100   100     05:09   0:00.03   4096 node /opt/aip/main.ts mcp --worker abc
  102   100   100     05:00   0:30.00 122880 /bin/sh -c npm run dev
  103   102   100     04:59   1:00.00 245760 node /repo/node_modules/.bin/vite --port 5173
  200     1   200     10:00   0:05.00   8192 /usr/bin/other thing
  300     1   100     00:00   0:00.00   1024 orphan-in-group
`;

const LINUX = `    1     0     1 1-02:03:04 00:00:10   1000 /sbin/init
  500     1   500    00:00:10 00:00:05   2048 /usr/bin/claude
  501   500   500    00:00:09 00:00:00   2048 sleep 300
`;

const root = (pid: number): AgentRoot => ({ pid, run: 'run-1', group: 'login', seq: 1 });

describe('parseClock', () => {
  it('reads the formats of macOS and Linux', () => {
    expect(parseClock('0:00.03')).toBeCloseTo(0.03);
    expect(parseClock('05:10')).toBe(310);
    expect(parseClock('00:00:10')).toBe(10);
    expect(parseClock('1-02:03:04')).toBe(86_400 + 7_384);
    expect(parseClock('1:02:03')).toBe(3_723);
    expect(parseClock('garbage')).toBe(0);
  });
});

describe('parsePs', () => {
  it('keeps the rest of the line as the command', () => {
    const rows = parsePs(MAC);
    expect(rows).toHaveLength(6);
    expect(rows[3]).toEqual({
      pid: 103,
      ppid: 102,
      pgid: 100,
      elapsed: 299,
      cpuSeconds: 60,
      rssKb: 245760,
      args: 'node /repo/node_modules/.bin/vite --port 5173',
    });
    expect(parsePs(LINUX)[0]?.elapsed).toBe(93_784);
  });

  it('skips lines it cannot read', () => {
    expect(parsePs('PID PPID\n\nnot a row\n')).toEqual([]);
  });
});

describe('selectBackground', () => {
  it('takes descendants and group members, not the agent, its MCP server or foreign processes', () => {
    const found = selectBackground(parsePs(MAC), [root(100)]);
    expect(found.map((process) => process.pid)).toEqual([102, 103, 300]);
    expect(found[0]).toMatchObject({
      name: 'sh',
      command: '/bin/sh -c npm run dev',
      uptimeSeconds: 300,
      memoryBytes: 122880 * 1024,
      root: { pid: 100, run: 'run-1' },
    });
    expect(found[0]?.cpuPercent).toBeCloseTo(10);
    expect(found[1]).toMatchObject({ name: 'node', uptimeSeconds: 299 });
    expect(found[1]?.cpuPercent).toBeCloseTo((60 / 299) * 100);
  });

  it('finds an orphan in the group of an agent that already exited', () => {
    const rows: PsRow[] = parsePs(LINUX).filter((row) => row.pid !== 500);
    const found = selectBackground(rows, [root(500)]);
    expect(found.map((process) => process.pid)).toEqual([501]);
  });

  it('reports zero CPU for a process that has just started', () => {
    const rows = parsePs('  7 1 7 00:00 0:00.00 10 agent\n  8 7 7 00:00 0:00.00 10 child --x\n');
    expect(selectBackground(rows, [root(7)])[0]).toMatchObject({ pid: 8, cpuPercent: 0 });
  });

  it('shows nothing without roots', () => {
    expect(selectBackground(parsePs(MAC), [])).toEqual([]);
  });
});

describe('snapshotProcesses', () => {
  it('runs ps over all processes and parses its output', async () => {
    let seen: string[] = [];
    const rows = await snapshotProcesses((_file, args, _options, callback) => {
      seen = args;
      callback(null, LINUX);
    });
    expect(seen).toEqual(['-A', '-o', 'pid=,ppid=,pgid=,etime=,time=,rss=,args=']);
    expect(rows).toHaveLength(3);
  });

  it('rejects when ps fails', async () => {
    await expect(
      snapshotProcesses((_file, _args, _options, callback) => callback(new Error('no ps'), '')),
    ).rejects.toThrow('no ps');
  });
});

describe('terminateTree', () => {
  const rows = parsePs(MAC);

  it('sends SIGTERM to the tree, then SIGKILL to what is still background', async () => {
    const sent: [number, string][] = [];
    const waits: number[] = [];
    const targets = await terminateTree(102, {
      rows,
      kill: (pid, signal) => void sent.push([pid, signal]),
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      stillBackground: () => Promise.resolve(new Set([103, 999])),
    });
    expect(targets).toEqual([102, 103]);
    expect(waits).toEqual([5_000]);
    expect(sent).toEqual([
      [102, 'SIGTERM'],
      [103, 'SIGTERM'],
      [103, 'SIGKILL'],
    ]);
  });

  it('ignores a process that is already gone', async () => {
    const gone = Object.assign(new Error('gone'), { code: 'ESRCH' });
    await expect(
      terminateTree(102, {
        rows,
        kill: () => {
          throw gone;
        },
        wait: () => Promise.resolve(),
        stillBackground: () => Promise.resolve(new Set([102])),
      }),
    ).resolves.toEqual([102, 103]);
  });
});

let current: Harness | null = null;
afterEach(async () => {
  await current?.close();
  current = null;
});

describe('background processes of a daemon', () => {
  it('lists what the agent started and ends it on request', async () => {
    const h = (current = await start());
    h.script({ code: [{ child: true, hang: true }] });
    const runId = await run(h);
    const childrenFile = join(h.fakeState, 'children');
    await until('the child of the agent', () => existsSync(childrenFile));
    const child = Number(readFileSync(childrenFile, 'utf8').trim().split('\n')[0]);
    await until('the child listed', async () => {
      const view = (await h.call('processes', {})) as BackgroundProcessesView;
      return view.processes.some((process) => process.pid === child);
    });
    const view = (await h.call('processes', {})) as BackgroundProcessesView;
    const listed = view.processes.find((process) => process.pid === child);
    expect(listed).toMatchObject({
      name: 'sleep',
      command: 'sleep 300',
      owner: { runId, repository: h.repo, group: expect.any(String), step: 'code' },
    });
    expect(listed?.memoryBytes).toBeGreaterThan(0);

    await expect(h.call('process_kill', { pid: process.pid })).rejects.toThrow(
      `not a background process: ${process.pid}`,
    );
    expect(alive(process.pid)).toBe(true);

    await h.call('process_kill', { pid: child });
    await until('the child ended', () => !alive(child));
    await until('the child gone from the list', async () => {
      const after = (await h.call('processes', {})) as BackgroundProcessesView;
      return after.processes.every((process) => process.pid !== child);
    });
    await h.call('cancel', { runId });
  });

  it('still lists a process that outlived a cancelled agent, until it ends', async () => {
    const h = (current = await start());
    h.script({ code: [{ stubbornChild: true, hang: true }] });
    const runId = await run(h);
    const childrenFile = join(h.fakeState, 'children');
    await until('the child of the agent', () => existsSync(childrenFile));
    const child = Number(readFileSync(childrenFile, 'utf8').trim().split('\n')[0]);
    const listed = async () =>
      ((await h.call('processes', {})) as BackgroundProcessesView).processes.some(
        (process) => process.pid === child,
      );
    await until('the child listed', listed);
    await h.call('cancel', { runId });
    await h.waitFor(runId, (view) => view.finished);
    expect(alive(child)).toBe(true);
    await until('the orphan still listed after the agent exited', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      return listed();
    });
    process.kill(child, 'SIGKILL');
    await until('the orphan gone from the list', async () => !(await listed()));
  });
});

type ProcessesEvent = Extract<StreamEvent, { event: 'processes' }>;

function watch(h: Harness): { events: StreamEvent[]; stop: () => void } {
  const events: StreamEvent[] = [];
  const abort = new AbortController();
  void subscribe(
    h.socket,
    (line) => events.push(streamEventSchema.parse(JSON.parse(line))),
    abort.signal,
  ).catch(() => undefined);
  return { events, stop: () => abort.abort() };
}

const processEvents = (events: StreamEvent[]): ProcessesEvent[] =>
  events.filter((event): event is ProcessesEvent => event.event === 'processes');

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('background processes in the event stream', () => {
  it('sends the child of an agent and then the list without it', async () => {
    const h = (current = await harness(undefined, {}, { processesIntervalMs: 100 }));
    h.script({ code: [{ child: true, hang: true }] });
    const stream = watch(h);
    const runId = await run(h);
    const childrenFile = join(h.fakeState, 'children');
    await until('the child of the agent', () => existsSync(childrenFile));
    const child = Number(readFileSync(childrenFile, 'utf8').trim().split('\n')[0]);
    const has = (event: ProcessesEvent) =>
      (event.processes ?? []).some((process) => process.pid === child);
    await until('the event with the child', () => processEvents(stream.events).some(has));
    process.kill(child, 'SIGKILL');
    await until('the event without the child', () => {
      const all = processEvents(stream.events);
      const last = all[all.length - 1];
      return all.some(has) && last !== undefined && !has(last);
    });
    stream.stop();
    await h.call('cancel', { runId });
  });

  it('does not look without subscribers, once when idle, and says an error once', async () => {
    let calls = 0;
    const h = (current = await harness(
      undefined,
      {},
      {
        processesIntervalMs: 30,
        snapshotProcesses: () => {
          calls += 1;
          return Promise.resolve([]);
        },
      },
    ));
    await pause(150);
    expect(calls).toBe(0);
    const first = watch(h);
    await until('the first list', () => processEvents(first.events).length === 1);
    const second = watch(h);
    await until(
      'the list for the second subscriber',
      () => processEvents(second.events).length === 1,
    );
    expect(second.events[0]?.event).toBe('snapshot');
    await pause(200);
    expect(calls).toBe(1);
    expect(processEvents(first.events)).toHaveLength(1);
    first.stop();
    second.stop();
  });

  it('sends the same error once', async () => {
    let calls = 0;
    const h = (current = await harness(
      undefined,
      {},
      {
        processesIntervalMs: 30,
        snapshotProcesses: () => {
          calls += 1;
          return Promise.reject(new Error('no ps'));
        },
      },
    ));
    const stream = watch(h);
    await until('the error', () => processEvents(stream.events).length === 1);
    await until('more looks', () => calls >= 3);
    expect(processEvents(stream.events)).toMatchObject([{ error: 'no ps' }]);
    stream.stop();
  });

  it('sends the list without a killed process within a second', async () => {
    const h = (current = await harness(undefined, {}, { processesIntervalMs: 60_000 }));
    h.script({ code: [{ child: true, hang: true }] });
    const stream = watch(h);
    const runId = await run(h);
    const childrenFile = join(h.fakeState, 'children');
    await until('the child of the agent', () => existsSync(childrenFile));
    const child = Number(readFileSync(childrenFile, 'utf8').trim().split('\n')[0]);
    // The interval is long: the first look found nothing, so ask for a fresh one by listing.
    await until('the child listed', async () => {
      const view = (await h.call('processes', {})) as BackgroundProcessesView;
      return view.processes.some((process) => process.pid === child);
    });
    stream.stop();
    const later = watch(h);
    await until('the list with the child', () =>
      processEvents(later.events).some((event) =>
        (event.processes ?? []).some((process) => process.pid === child),
      ),
    );
    const before = later.events.length;
    await h.call('process_kill', { pid: child });
    const started = Date.now();
    await until('the list without the child', () =>
      processEvents(later.events.slice(before)).some(
        (event) => !(event.processes ?? []).some((process) => process.pid === child),
      ),
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    later.stop();
    await h.call('cancel', { runId });
  });
});
