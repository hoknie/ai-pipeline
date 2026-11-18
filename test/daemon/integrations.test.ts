import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationAdapterPort } from '../../src/feature/integrations/ports/index.ts';
import type {
  ConnectionView,
  IntegrationTypeView,
  QueueView,
} from '../../src/presentation/ipc/contract/index.ts';
import { subscribe } from '../../src/presentation/ipc/client/index.ts';
import { MemoryStore, SENTINEL } from '../feature/integrations/helpers.ts';

import { harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.close();
  current = null;
});

const EXAMPLE: IntegrationAdapterPort['descriptor'] = {
  kind: 'example',
  title: 'Example',
  params: [{ name: 'account', required: false, maxLength: 40 }],
  secrets: [{ slot: 'token', required: true }],
  directions: ['inbound'],
  operations: ['queue_task', 'cancel_run'],
};

/** A verifier of the tests: the secret itself must come in the `x-token` header. */
function tokenAdapter(): IntegrationAdapterPort {
  return {
    descriptor: EXAMPLE,
    verifier: {
      async verify(context) {
        if (context.headers['x-token'] !== (await context.secrets.read('token'))) return null;
        const payload = JSON.parse(new TextDecoder().decode(context.body)) as {
          id: string;
          operation: never;
        };
        return context.accept({ externalEventId: payload.id, operation: payload.operation });
      },
    },
  };
}

function keyFile(): string {
  const file = join(realpathSync(mkdtempSync(join(tmpdir(), 'aip-key-'))), 'key');
  writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  return file;
}

async function start(
  options: {
    adapters?: IntegrationAdapterPort[];
    secretStore?: MemoryStore;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<Harness> {
  current = await harness(undefined, options.environment ?? {}, {
    integrations: {
      adapters: options.adapters ?? [],
      ...(options.secretStore ? { secretStore: options.secretStore } : {}),
    },
  });
  await current.call('repository_add', { path: current.repo });
  return current;
}

const list = async (h: Harness): Promise<ConnectionView[]> =>
  (await h.call('integration_list', {})) as ConnectionView[];

const services = (h: Harness) => h.running.application.services.integrations;

/** Writes one raw line on the socket and collects what the daemon answers until it closes or ends the line. */
function raw(socket: string, payload: string, options: { close?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    const connection = createConnection(socket);
    let answer = '';
    connection.setEncoding('utf8');
    connection.on('data', (chunk: string) => {
      answer += chunk;
      if (answer.includes('\n') && options.close !== true) connection.end();
    });
    connection.on('close', () => resolve(answer));
    connection.on('error', () => resolve(answer));
    connection.on('connect', () => connection.write(payload));
  });
}

describe('an empty catalog', () => {
  it('lists no kinds, refuses an unknown one and opens no listener or outbound connection', async () => {
    const h = await start();
    expect(await h.call('integration_types', {})).toEqual([]);
    await expect(
      h.call('integration_add', { kind: 'unknown', name: 'main', global: true }),
    ).rejects.toThrow(/unknown integration kind/);
    expect(await list(h)).toEqual([]);
    // Only the Unix socket of the daemon is open: no TCP listener of the process is added.
    let sockets = '';
    try {
      sockets = execFileSync(
        'lsof',
        ['-a', '-nP', '-p', String(process.pid), '-iTCP', '-sTCP:LISTEN'],
        { encoding: 'utf8' },
      ).trim();
    } catch (error) {
      const failure = error as { code?: string; status?: number };
      // lsof exits with 1 when nothing matches; a missing tool is not a pass.
      if (failure.code === 'ENOENT') {
        const listening = (process as unknown as { getActiveResourcesInfo(): string[] })
          .getActiveResourcesInfo()
          .filter((name) => name === 'TCPServerWrap');
        expect(listening).toEqual([]);
      } else expect(failure.status).toBe(1);
    }
    expect(sockets).toBe('');
    // No outbound connection either: nothing is open as a TCP socket of the process.
    const sockets2 = (process as unknown as { getActiveResourcesInfo(): string[] })
      .getActiveResourcesInfo()
      .filter((name) => name === 'TCPSocketWrap' || name === 'TCPConnectWrap');
    expect(sockets2).toEqual([]);
  });
});

describe('connections and projects', () => {
  it('keeps the id of a connection when its project moves, and refuses to remove a project with one', async () => {
    const store = new MemoryStore();
    const h = await start({ adapters: [tokenAdapter()], secretStore: store });
    const created = (await h.call('integration_add', {
      kind: 'example',
      name: 'main',
      repository: h.repo,
    })) as ConnectionView;
    await h.call('integration_secret_set', { id: created.id, slot: 'token', value: SENTINEL });
    await expect(h.call('repository_remove', { path: h.repo })).rejects.toThrow(
      /still has integration connections/,
    );
    expect(await list(h)).toHaveLength(1);
    const moved = join(dirname(h.repo), 'moved');
    renameSync(h.repo, moved);
    await h.call('repository_move', { path: h.repo, to: moved });
    const [after] = await list(h);
    expect(after).toMatchObject({ id: created.id, project: moved });
    expect(await services(h).secrets.read(created.id, 'token')).toBe(SENTINEL);
    expect(await h.call('integration_list', { repository: moved })).toHaveLength(1);
    await h.call('integration_remove', { id: created.id });
    await h.call('repository_remove', { path: moved });
  });

  it('keeps connections and a secret of the encrypted file over a restart, without values in answers', async () => {
    const environment = { AIP_SECRETS_BACKEND: 'file', AIP_SECRETS_KEY_FILE: keyFile() };
    const h = await start({ adapters: [tokenAdapter()], environment });
    const created = (await h.call('integration_add', {
      kind: 'example',
      name: 'main',
      repository: h.repo,
      params: { account: 'acme' },
    })) as ConnectionView;
    const set = await h.call('integration_secret_set', {
      id: created.id,
      slot: 'token',
      value: SENTINEL,
    });
    expect(JSON.stringify(set)).not.toContain(SENTINEL);
    await h.call('integration_enable', { id: created.id });
    await h.restart();
    const [after] = await list(h);
    expect(after).toMatchObject({
      id: created.id,
      enabled: true,
      params: { account: 'acme' },
      secrets: [{ slot: 'token', required: true, present: true }],
    });
    expect(JSON.stringify(after)).not.toContain(SENTINEL);
    expect(await services(h).secrets.read(created.id, 'token')).toBe(SENTINEL);
    const files = readdirSync(join(h.state, 'secrets'));
    expect(files).toContain('store.enc.json');
    for (const file of files) {
      expect(readFileSync(join(h.state, 'secrets', file), 'utf8')).not.toContain(SENTINEL);
    }
    expect(readFileSync(join(h.state, 'aip.db'), 'latin1')).not.toContain(SENTINEL);
  });

  it('refuses secrets without a usable backend and leaves no plaintext', async () => {
    const h = await start({
      adapters: [tokenAdapter()],
      environment: { AIP_SECRETS_BACKEND: 'file' },
    });
    const created = (await h.call('integration_add', {
      kind: 'example',
      name: 'main',
      repository: h.repo,
    })) as ConnectionView;
    await expect(
      h.call('integration_secret_set', { id: created.id, slot: 'token', value: SENTINEL }),
    ).rejects.toThrow(/secret storage is unavailable/);
    await expect(h.call('integration_enable', { id: created.id })).rejects.toThrow(/token/);
    expect(existsSync(join(h.state, 'secrets', 'store.enc.json'))).toBe(false);
    expect((await list(h))[0]?.secrets[0]?.present).toBe(false);
  });
});

describe('inbound events through the services of the queue and the runs', () => {
  async function connected(h: Harness): Promise<string> {
    const created = (await h.call('integration_add', {
      kind: 'example',
      name: 'main',
      repository: h.repo,
    })) as ConnectionView;
    await h.call('integration_secret_set', { id: created.id, slot: 'token', value: 'tok' });
    await h.call('integration_enable', { id: created.id });
    return created.id;
  }
  const event = (id: string, operation: unknown, token = 'tok', eventId = 'e1') => ({
    verifier: 'example',
    connectionId: id,
    body: new TextEncoder().encode(JSON.stringify({ id: eventId, operation })),
    headers: { 'x-token': token },
  });

  it('queues a task once, however often the event is delivered', async () => {
    const h = await start({ adapters: [tokenAdapter()], secretStore: new MemoryStore() });
    const id = await connected(h);
    const task = { type: 'queue_task', pipeline: 'feature', task: 'from outside' };
    const first = await services(h).inbound.receive(event(id, task));
    expect(first.status).toBe('applied');
    const second = await services(h).inbound.receive(event(id, task));
    expect(second.status).toBe('duplicate');
    const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(queue.items.map((item) => item.task)).toEqual(['from outside']);
    await expect(services(h).inbound.receive(event(id, task, 'wrong'))).rejects.toThrow(
      /authentication failed/,
    );
  });

  it('cancels a run through its machine and refuses a run that does not exist, without a false success', async () => {
    const h = await start({ adapters: [tokenAdapter()], secretStore: new MemoryStore() });
    const id = await connected(h);
    h.script({ code: [{ waitFor: h.gate('hold') }] });
    const run = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'work' });
    await until(
      'the step starts',
      async () => (await h.status(run.runId)).groups[0]?.status === 'running',
    );
    const outcome = await services(h).inbound.receive(
      event(id, { type: 'cancel_run', runId: run.runId }),
    );
    expect(outcome).toMatchObject({ status: 'applied', result: { cancelled: true } });
    const cancelled = await h.waitFor(run.runId, (view) =>
      view.groups.every((group) => group.status === 'cancelled'),
    );
    expect(cancelled.groups.every((group) => group.status === 'cancelled')).toBe(true);
    h.open('hold');
    const missing = { ...event(id, { type: 'cancel_run', runId: 'nope' }, 'tok', 'e2') };
    await expect(services(h).inbound.receive(missing)).rejects.toThrow(/not allowed/);
    const rows = (await services(h).connections.list()).length;
    expect(rows).toBe(1);
  });
});

describe('errors of the socket never carry a request', () => {
  const quiet = () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    return written;
  };

  it('answers a broken envelope, method or parameters with a fixed code', async () => {
    const h = await start({ adapters: [tokenAdapter()], secretStore: new MemoryStore() });
    const log = quiet();
    const lines = [
      `{"id":1,"method":"integration_secret_set","params":{"value":"${SENTINEL}"`,
      `{"id":1,"params":{"value":"${SENTINEL}"}}`,
      `{"id":1,"method":42,"params":{"value":"${SENTINEL}"}}`,
      `{"id":1,"method":"${SENTINEL}","params":{}}`,
      `{"id":1,"method":"integration_secret_set","params":{"id":"c","slot":"BAD ${SENTINEL}","value":"${SENTINEL}"}}`,
      `{"id":1,"method":"tags","params":{"repository":["${SENTINEL}"]}}`,
      `[${JSON.stringify(SENTINEL)}]`,
    ];
    const answers: string[] = [];
    for (const line of lines) answers.push(await raw(h.socket, `${line}\n`));
    for (const answer of answers) {
      expect(answer).not.toContain(SENTINEL);
      expect(JSON.parse(answer)).toMatchObject({ ok: false, code: expect.any(String) });
    }
    expect(answers.map((answer) => JSON.parse(answer).code)).toEqual([
      'invalid_json',
      'invalid_request',
      'invalid_request',
      'unknown_method',
      'invalid_params',
      'invalid_params',
      'invalid_request',
    ]);
    expect(log.join('')).not.toContain(SENTINEL);
  });

  it('replaces the text of an exception of a handler or of the secret store', async () => {
    const store = new MemoryStore();
    const h = await start({ adapters: [tokenAdapter()], secretStore: store });
    const log = quiet();
    const created = (await h.call('integration_add', {
      kind: 'example',
      name: 'main',
      repository: h.repo,
    })) as ConnectionView;
    store.failNext.add('put');
    const failed = await raw(
      h.socket,
      `${JSON.stringify({ id: 2, method: 'integration_secret_set', params: { id: created.id, slot: 'token', value: SENTINEL } })}\n`,
    );
    expect(failed).not.toContain(SENTINEL);
    expect(JSON.parse(failed)).toMatchObject({ ok: false });
    vi.spyOn(h.running.application.services.tags, 'catalogFor').mockRejectedValue(
      Object.assign(new Error(`boom ${SENTINEL}`), { cause: new Error(SENTINEL) }),
    );
    const boom = await raw(
      h.socket,
      `${JSON.stringify({ id: 3, method: 'tags', params: { repository: h.repo } })}\n`,
    );
    expect(boom).not.toContain(SENTINEL);
    expect(JSON.parse(boom)).toMatchObject({
      ok: false,
      code: 'internal',
      error: 'request failed',
    });
    expect(log.join('')).not.toContain(SENTINEL);
  });

  it('cuts off a request that grows without a newline, before it is parsed', async () => {
    const h = await start();
    const log = quiet();
    const head = `{"id":1,"method":"integration_secret_set","params":{"value":"${SENTINEL}`;
    const answer = await raw(h.socket, head + 'x'.repeat(5 * 1024 * 1024), { close: true });
    expect(answer).not.toContain(SENTINEL);
    if (answer !== '')
      expect(JSON.parse(answer)).toMatchObject({ ok: false, code: 'request_too_large' });
    expect(log.join('')).not.toContain(SENTINEL);
    // The daemon still serves.
    expect(await h.call('integration_types', {})).toEqual([]);
  });

  it('keeps secrets out of the event stream', async () => {
    const h = await start({ adapters: [tokenAdapter()], secretStore: new MemoryStore() });
    const lines: string[] = [];
    const controller = new AbortController();
    const ended = subscribe(h.socket, (line) => lines.push(line), controller.signal);
    const created = (await h.call('integration_add', {
      kind: 'example',
      name: 'main',
      repository: h.repo,
    })) as ConnectionView;
    await h.call('integration_secret_set', { id: created.id, slot: 'token', value: SENTINEL });
    await h.call('integration_types', {});
    await until('the snapshot', () => lines.length > 0);
    controller.abort();
    await ended;
    expect(lines.join('\n')).not.toContain(SENTINEL);
    expect((await h.call('integration_types', {})) as IntegrationTypeView[]).toHaveLength(1);
  });
});
