import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionView } from '../../src/presentation/ipc/contract/index.ts';
import { startFakeRegistry, type FakeRegistry } from '../fakes/registry-api.ts';
import { MemoryStore } from '../feature/integrations/helpers.ts';

import { CODE_ONLY_CONFIG, harness, startRun, until, type Harness } from './harness.ts';

let daemon: Harness | null = null;
let registry: FakeRegistry | null = null;

afterEach(async () => {
  await daemon?.close();
  await registry?.close();
  daemon = null;
  registry = null;
});

const CONFIG = `${CODE_ONLY_CONFIG}  mcp_servers:
    registry: { connection: main, all_specialists: true }
`;

interface Started {
  h: Harness;
  fake: FakeRegistry;
  store: MemoryStore;
}

/** A daemon whose catalog has the server `registry`; the connection `main` is made by the test. */
async function start(): Promise<Started> {
  registry = await startFakeRegistry();
  const store = new MemoryStore();
  daemon = await harness(CONFIG, {}, { integrations: { secretStore: store } });
  mkdirSync(daemon.fakeState, { recursive: true });
  daemon.environment.AIP_FAKE_ARGV_LOG = join(daemon.fakeState, 'argv.jsonl');
  return { h: daemon, fake: registry, store };
}

async function connect(h: Harness, fake: FakeRegistry, token = fake.token): Promise<string> {
  const added = (await h.call('integration_add', {
    kind: 'service-registry',
    name: 'main',
    global: true,
    params: { url: fake.base },
  })) as ConnectionView;
  await h.call('integration_secret_set', { id: added.id, slot: 'token', value: token });
  await h.call('integration_enable', { id: added.id });
  return added.id;
}

const REMOTE = {
  server: 'registry',
  calls: [
    { method: 'tools/list' },
    { method: 'tools/call', params: { name: 'list_projects', arguments: { limit: 3 } } },
  ],
};

async function runOnce(h: Harness) {
  const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'do it' });
  return h.waitFor(runId, (view) => view.finished);
}

function lines(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Every file below the directory, as bytes: the files of the attempts, the logs, the database. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('the MCP servers of a specialist that go through a connection', () => {
  it('gives the agent the tools of the registry through the bridge and never the token', async () => {
    const { h, fake } = await start();
    await connect(h, fake);
    h.script({ code: [{ remote: REMOTE }] });
    const final = await runOnce(h);
    expect(final.groups[0]?.reason).toBeNull();
    expect(final.groups[0]?.status).toBe('merged');

    const answers = lines(join(h.fakeState, 'remote.jsonl'));
    expect(answers.map((one) => one.method)).toEqual(['tools/list', 'tools/call']);
    expect(JSON.stringify(answers[0]?.result)).toContain('list_projects');
    expect(JSON.stringify(answers[1]?.result)).toContain('called list_projects {\\"limit\\":3}');

    // the registry saw one session with the token of the connection, closed at the end
    await until('the session is closed', () => fake.closed.length === 1);
    const methods = fake.requests.map((one) => one.body?.method ?? one.method);
    expect(methods).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/call',
      'DELETE',
    ]);
    expect(fake.requests.every((one) => one.authorization === `Bearer ${fake.token}`)).toBe(true);
    expect(fake.requests.slice(1).every((one) => one.sessionId === 'session-1')).toBe(true);
    expect(fake.closed).toEqual(['session-1']);

    // the config of the attempt holds the command of the bridge and nothing else
    const argv = lines(join(h.fakeState, 'argv.jsonl')).find((one) =>
      (one.argv as string[]).includes('--session-id'),
    ) as { argv: string[] };
    const configFile = argv.argv[argv.argv.indexOf('--mcp-config') + 1]!;
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env?: object }>;
    };
    const bridge = config.mcpServers.registry!;
    expect(bridge.args).toEqual(
      expect.arrayContaining(['mcp', '--remote', 'registry', '--worker', '--socket', h.socket]),
    );
    expect(bridge.args).not.toContain('--split');

    // the token of the connection is in no file below the directory of the test, nor in an argument
    for (const file of filesUnder(dirname(h.repo))) {
      const bytes = readFileSync(file);
      expect(bytes.includes(fake.token), file).toBe(false);
    }
    expect(JSON.stringify(argv.argv)).not.toContain(fake.token);
  });

  it('refuses to start without the connection, naming the server and the connection', async () => {
    const { h } = await start();
    h.script({ code: [{}] });
    const final = await runOnce(h);
    expect(final.groups[0]?.status).toBe('failed');
    expect(final.groups[0]?.reason).toContain(
      'MCP server registry: connection main is not available for this project',
    );
    expect(existsSync(join(h.fakeState, 'calls.jsonl'))).toBe(false);
  });

  it('refuses to start with a disabled connection or without its token, never asking the registry', async () => {
    const { h, fake } = await start();
    const id = await connect(h, fake);
    await h.call('integration_disable', { id });
    h.script({ code: [{}] });
    const disabled = await runOnce(h);
    expect(disabled.groups[0]?.reason).toContain(
      'MCP server registry: connection main is disabled',
    );
    await h.call('integration_secret_remove', { id, slot: 'token' });
    const missing = await runOnce(h);
    expect(missing.groups[0]?.reason).toContain('MCP server registry: connection main is disabled');
    expect(fake.requests).toEqual([]);
    expect(existsSync(join(h.fakeState, 'calls.jsonl'))).toBe(false);
  });
});

describe('the forwarding of the bridge', () => {
  /** Holds an attempt of a specialist and returns the token of its bridge. */
  async function held(h: Harness): Promise<{ token: string; runId: string }> {
    h.script({ code: [{ waitFor: h.gate('go') }] });
    const { runId } = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'do it',
    });
    // other calls of the fake agent (the naming of the run) are logged before the attempt starts
    const started = () =>
      existsSync(join(h.fakeState, 'argv.jsonl'))
        ? (lines(join(h.fakeState, 'argv.jsonl')).find((one) =>
            (one.argv as string[]).includes('--session-id'),
          ) as { argv: string[] } | undefined)
        : undefined;
    await until('the agent started', () => started() !== undefined);
    const argv = started()!;
    const file = argv.argv[argv.argv.indexOf('--mcp-config') + 1]!;
    const config = JSON.parse(readFileSync(file, 'utf8')) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    const args = config.mcpServers.registry!.args;
    return { token: args[args.indexOf('--worker') + 1]!, runId };
  }

  const list = { jsonrpc: '2.0', id: 5, method: 'tools/list' };
  const forward = (h: Harness, token: string, server: string, message: object = list) =>
    h.call('mcp_remote_forward', { token, server, message: message as never }) as Promise<{
      message: { result?: unknown; error?: { message: string } } | null;
    }>;

  it('answers server_not_allowed for a server outside the set, without reading the secret', async () => {
    const { h, fake, store } = await start();
    await connect(h, fake);
    const { token, runId } = await held(h);
    const before = store.calls.length;
    const refused = await forward(h, token, 'github');
    expect(refused.message?.error?.message).toBe('server_not_allowed');
    expect(store.calls.length).toBe(before);
    expect(fake.requests).toEqual([]);
    h.open('go');
    await h.waitFor(runId, (view) => view.finished);
  });

  it('answers connection_disabled when the connection is switched off during the step', async () => {
    const { h, fake } = await start();
    const id = await connect(h, fake);
    const { token, runId } = await held(h);
    const first = await forward(h, token, 'registry');
    expect(JSON.stringify(first.message?.result)).toContain('list_projects');
    const seen = fake.requests.length;
    await h.call('integration_disable', { id });
    const refused = await forward(h, token, 'registry');
    expect(refused.message?.error?.message).toBe('connection_disabled');
    expect(fake.requests.length).toBe(seen);
    expect(JSON.stringify(refused)).not.toContain(fake.token);
    h.open('go');
    await h.waitFor(runId, (view) => view.finished);
  });

  it('answers a notification of a refused bridge with nothing', async () => {
    const { h, fake } = await start();
    await connect(h, fake);
    const { token, runId } = await held(h);
    const answer = await forward(h, token, 'github', { jsonrpc: '2.0', method: 'x' });
    expect(answer.message).toBeNull();
    h.open('go');
    await h.waitFor(runId, (view) => view.finished);
  });

  it('answers attempt_finished for the token of an attempt that ended, without asking the registry', async () => {
    const { h, fake } = await start();
    await connect(h, fake);
    const { token, runId } = await held(h);
    h.open('go');
    await h.waitFor(runId, (view) => view.finished);
    const refused = await forward(h, token, 'registry');
    expect(refused.message?.error?.message).toBe('attempt_finished');
    expect(fake.requests).toEqual([]);
    const unknown = await forward(h, 'not-a-token', 'registry');
    expect(unknown.message?.error?.message).toBe('attempt_finished');
  });

  it('turns a failure of the registry into the static code of the error and keeps the attempt', async () => {
    const { h, fake } = await start();
    await connect(h, fake);
    const { token, runId } = await held(h);
    for (const [status, code] of [
      [401, 'unauthorized'],
      [503, 'unreachable'],
    ] as const) {
      fake.failWith.push(status);
      const answer = await forward(h, token, 'registry');
      expect(answer.message?.error?.message).toBe(code);
      expect(JSON.stringify(answer)).not.toContain('secret detail');
    }
    fake.rawBody = 'nonsense';
    expect((await forward(h, token, 'registry')).message?.error?.message).toBe('protocol');
    h.open('go');
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups[0]?.status).toBe('merged');
  });
});
