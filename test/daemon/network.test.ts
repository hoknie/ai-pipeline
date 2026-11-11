import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunView } from '../../src/presentation/ipc/contract/index.ts';

import { PIPELINE_CONFIG, harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;
let server: Server | null = null;
/** The clock of the daemon runs this many ms ahead of the wall clock. */
let skewMs = 0;

afterEach(async () => {
  await current?.close();
  current = null;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function start(): Promise<{ h: Harness; settings(text: string): void }> {
  skewMs = 0;
  const h = (current = await harness(PIPELINE_CONFIG, {}, { now: () => Date.now() + skewMs }));
  const directory = join(h.environment.XDG_CONFIG_HOME!, 'aip');
  mkdirSync(directory, { recursive: true });
  return { h, settings: (text) => writeFileSync(join(directory, 'settings.yaml'), text) };
}

const monitor = (h: Harness) => h.running.application.services.network;

/** The daemon wakes up as it does after a timer: schedules the groups that may start. */
async function wake(h: Harness): Promise<void> {
  const { engine } = h.running.application.services.runs;
  await engine.serial(() => engine.wake());
}

async function localTarget(): Promise<string> {
  server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
}

const MISSING = 'network: { enabled: true, interfaces: [aip-no-such-interface] }\n';

const calls = (h: Harness): { step: string; args: string[] }[] =>
  existsSync(join(h.fakeState, 'calls.jsonl'))
    ? readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];

const first = (view: RunView) => view.groups[0];

async function newRun(h: Harness): Promise<string> {
  return (await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'сделать' })).runId;
}

describe('the network guard of the daemon', () => {
  it('holds the groups while the network is down and starts them when it is back', async () => {
    const { h, settings } = await start();
    settings(MISSING);
    await monitor(h).checkNow();
    expect(monitor(h).state()).toMatchObject({
      state: 'down',
      problem: 'interface aip-no-such-interface is down',
    });
    const runId = await newRun(h);
    const waiting = await h.waitFor(runId, (view) => first(view)?.status === 'waiting');
    expect(first(waiting)?.wait).toEqual({
      reason: 'network',
      problem: 'interface aip-no-such-interface is down',
      until: null,
    });
    expect(calls(h)).toEqual([]);

    settings('network: { enabled: false }\n');
    await monitor(h).checkNow();
    const done = await h.waitFor(runId, (view) => view.finished, 10_000);
    expect(first(done)?.status).toBe('merged');
  });

  it('does not stop a running agent when the network goes down, and holds its next step', async () => {
    const { h, settings } = await start();
    const target = await localTarget();
    settings(`network: { enabled: true, targets: ["${target}"] }\n`);
    await monitor(h).checkNow();
    expect(monitor(h).state().state).toBe('up');
    h.script({ code: [{ waitFor: h.gate('code') }] });
    const runId = await newRun(h);
    await h.waitFor(runId, (view) => first(view)?.status === 'running');

    settings(MISSING);
    await monitor(h).checkNow();
    expect(monitor(h).state().state).toBe('down');
    expect(first(await h.status(runId))?.status).toBe('running');
    h.open('code');
    const held = await h.waitFor(
      runId,
      (view) => first(view)?.status === 'waiting' && first(view)?.step === 'code',
    );
    expect(first(held)?.wait).toMatchObject({ reason: 'network', until: null });

    settings('network: { enabled: false }\n');
    await monitor(h).checkNow();
    const done = await h.waitFor(runId, (view) => view.finished, 10_000);
    expect(first(done)?.status).toBe('merged');
  });

  it('checks a stale state before the agent starts and does not start it into a dead network', async () => {
    const { h, settings } = await start();
    const target = await localTarget();
    settings(`network: { enabled: true, interval: 3600, targets: ["${target}"] }\n`);
    await monitor(h).checkNow();
    expect(monitor(h).state().state).toBe('up');
    server!.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    skewMs = 20_000;

    const runId = await newRun(h);
    const waiting = await h.waitFor(runId, (view) => first(view)?.status === 'waiting');
    expect(first(waiting)?.wait).toMatchObject({ reason: 'network' });
    expect(calls(h)).toEqual([]);
    expect(monitor(h).state().state).toBe('down');
    const group = await h.group(runId, first(waiting)!.slug);
    expect(group.attempts[0]).toMatchObject({ status: 'failed' });
    expect(group.attempts[0]?.reason).toContain('network: ');
  });

  it('retries a step after a network error of claude, after the pause and in the same session', async () => {
    const { h, settings } = await start();
    settings('network: { enabled: false }\n');
    h.script({ code: [{ networkError: 'API Error: Connection error.' }, {}] });
    const runId = await newRun(h);
    const waiting = await h.waitFor(
      runId,
      (view) => first(view)?.status === 'waiting' && first(view)?.wait?.reason === 'network',
    );
    const wait = first(waiting)?.wait as { reason: string; problem: string; until: number };
    expect(wait.until).toBeGreaterThan(Date.now() + 20_000);
    const group = await h.group(runId, first(waiting)!.slug);
    expect(group.attempts[0]?.reason).toBe('network: API Error: Connection error.');
    expect(calls(h).filter((call) => call.step === 'code')).toHaveLength(1);

    skewMs = 31_000;
    await wake(h);
    const done = await h.waitFor(runId, (view) => view.finished, 10_000);
    expect(first(done)?.status).toBe('merged');
    const code = calls(h).filter((call) => call.step === 'code');
    expect(code).toHaveLength(2);
    expect(code[1]?.args).toContain('--resume');
  });

  it('can cancel a group that waits after a network failure', async () => {
    const { h, settings } = await start();
    settings('network: { enabled: false }\n');
    h.script({ code: [{ networkError: 'Connection error' }, {}] });
    const runId = await newRun(h);
    const waiting = await h.waitFor(runId, (view) => first(view)?.wait?.reason === 'network');
    await h.call('cancel', { runId, group: first(waiting)!.slug });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(first(final)?.status).toBe('cancelled');
    expect(calls(h).filter((call) => call.step === 'code')).toHaveLength(1);
  });

  it('shows the state of the network in ping and network_status without the proxy password', async () => {
    const { h, settings } = await start();
    settings(`${MISSING.trim().slice(0, -1)}, proxy: "http://user:secret@127.0.0.1:9" }\n`);
    await monitor(h).checkNow();
    const status = (await h.call('network_status', {})) as Record<string, unknown>;
    expect(status).toMatchObject({
      state: 'down',
      problem: 'interface aip-no-such-interface is down',
      proxy: 'http://127.0.0.1:9',
    });
    expect(JSON.stringify(status)).not.toContain('secret');
    const ping = (await h.call('ping', {})) as { network?: { state: string } };
    expect(ping.network?.state).toBe('down');
  });

  it('gives agents the proxy, and the variables of the runtime win', async () => {
    const { h, settings } = await start();
    h.environment.AIP_FAKE_ARGV_LOG = join(h.fakeState, 'argv.jsonl');
    h.environment.AIP_FAKE_ENV_KEYS = 'HTTPS_PROXY,HTTP_PROXY';
    mkdirSync(h.fakeState, { recursive: true });
    settings(
      'network: { proxy: "http://a:3128" }\nruntimes:\n  claude:\n    env: { HTTPS_PROXY: "http://b:3128" }\n',
    );
    await h.waitFor(await newRun(h), (view) => view.finished, 10_000);
    const lines = readFileSync(join(h.fakeState, 'argv.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { argv: string[]; env: Record<string, string | null> });
    const step = lines.find((call) => call.argv.includes('--session-id'));
    expect(step?.env).toEqual({ HTTPS_PROXY: 'http://b:3128', HTTP_PROXY: 'http://a:3128' });
  });

  it('does not check the network while the section is off', async () => {
    const { h } = await start();
    await until('the first check', () => monitor(h).state().checkedAt === null);
    expect(monitor(h).state().state).toBe('off');
    await h.waitFor(await newRun(h), (view) => view.finished, 10_000);
    expect(monitor(h).state().checkedAt).toBeNull();
  });
});
