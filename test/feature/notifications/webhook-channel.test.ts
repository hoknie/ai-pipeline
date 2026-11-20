import { createHmac } from 'node:crypto';
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { connect, type AddressInfo, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  retryAfterMs,
  webhookChannelFactory,
} from '../../../src/feature/notifications/clients/webhook/channel.ts';
import type { ChannelOptions } from '../../../src/feature/notifications/ports/index.ts';
import {
  ChannelFailure,
  type AttemptRecord,
  type Delivery,
} from '../../../src/feature/notifications/types/index.ts';
import { TEST_CERT, TEST_KEY } from '../../fixtures/tls.ts';
import { startReceiver, type FakeReceiver } from '../../fakes/webhook-receiver.ts';

import { eventData } from './helpers.ts';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const closers: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function receiver(): Promise<FakeReceiver> {
  const one = await startReceiver();
  closers.push(() => one.close());
  return one;
}

const delivery = (patch: Partial<Delivery> = {}): Delivery => ({
  id: 7,
  shortKey: 'abc123',
  subscriptionId: 'n1',
  eventKey: 'r1/g/needs_human/1',
  kind: 'question',
  run: 'r1',
  group: 'g',
  questionKey: 'r1/g/needs_human/1',
  payload: eventData({ question: 'Which one?' }),
  state: 'pending',
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  external: null,
  closedBy: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...patch,
});

function channelOf(
  params: Record<string, string>,
  options: { proxy?: string | null; ca?: string; timeoutMs?: number; secret?: string | null } = {},
) {
  const records: AttemptRecord[] = [];
  const connection = { id: 'c1', name: 'ci', kind: 'webhook', params };
  const channelOptions: ChannelOptions = {
    connection,
    now: () => 1_700_000_100_000,
    record: (_id, attempt) => void records.push(attempt),
    secret: () => Promise.resolve(options.secret === undefined ? SECRET : options.secret),
    cursor: { get: () => null, set: () => undefined },
  };
  const factory = webhookChannelFactory({
    proxy: () => options.proxy ?? null,
    version: 'test',
    ...(options.ca === undefined ? {} : { ca: options.ca }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const channel = factory.create(channelOptions);
  const send = (one: Delivery = delivery()) =>
    channel.deliver({ delivery: one, draw: () => null as never, publicUrl: 'https://aip.example' });
  return { send, records };
}

const failureOf = async (work: Promise<unknown>): Promise<ChannelFailure> => {
  const error = await work.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ChannelFailure);
  return error as ChannelFailure;
};

describe('the webhook channel: the request', () => {
  it('posts the signed body: the headers of Standard Webhooks and the json of the event', async () => {
    const hook = await receiver();
    const { send, records } = channelOf({ url: `${hook.base}/hook?token=abc` });
    const ref = await send();
    expect(ref).toMatchObject({ webhook_id: 'msg_abc123', status: 200 });
    const [seen] = hook.received;
    expect(seen).toMatchObject({ method: 'POST', path: '/hook?token=abc' });
    expect(seen?.headers['content-type']).toBe('application/json');
    expect(seen?.headers['user-agent']).toBe('aip-webhooks/test');
    expect(seen?.headers['webhook-id']).toBe('msg_abc123');
    expect(seen?.headers['webhook-timestamp']).toBe('1700000100');
    const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64');
    const expected = createHmac('sha256', key)
      .update(`msg_abc123.1700000100.${seen?.body}`)
      .digest('base64');
    expect(seen?.headers['webhook-signature']).toBe(`v1,${expected}`);
    const body = JSON.parse(seen!.body);
    expect(body.type).toBe('question.asked');
    expect(records).toMatchObject([{ statusCode: 200, errorKind: null }]);
  });

  it('keeps the id of the delivery across attempts, whatever time they happen at', async () => {
    const hook = await receiver();
    hook.answers.push({ status: 503 });
    const { send } = channelOf({ url: `${hook.base}/hook` });
    await failureOf(send());
    await send();
    expect(hook.received.map((one) => one.headers['webhook-id'])).toEqual([
      'msg_abc123',
      'msg_abc123',
    ]);
  });

  it('takes the address from the parameters at the moment of every attempt', async () => {
    const first = await receiver();
    const second = await receiver();
    const params: Record<string, string> = { url: `${first.base}/a` };
    const { send } = channelOf(params);
    await send();
    params.url = `${second.base}/b`;
    await send();
    expect(first.received.map((one) => one.path)).toEqual(['/a']);
    expect(second.received.map((one) => one.path)).toEqual(['/b']);
    expect(second.received[0]?.headers['webhook-id']).toBe(
      first.received[0]?.headers['webhook-id'],
    );
  });

  it('refuses without a secret and without an address, for good', async () => {
    const hook = await receiver();
    const noSecret = await failureOf(channelOf({ url: hook.base }, { secret: null }).send());
    expect(noSecret.permanent).toBe(true);
    const noUrl = await failureOf(channelOf({}).send());
    expect(noUrl.permanent).toBe(true);
    expect(hook.received).toHaveLength(0);
  });

  it('sends https to a receiver with a certificate of its own authority', async () => {
    const seen: string[] = [];
    const server = createHttps({ key: TEST_KEY, cert: TEST_CERT }, (request, response) => {
      seen.push(request.url ?? '');
      request.resume();
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise((resolve) => server.close(resolve)));
    const { port } = server.address() as AddressInfo;
    const { send } = channelOf({ url: `https://localhost:${port}/secure` }, { ca: TEST_CERT });
    await send();
    expect(seen).toEqual(['/secure']);
  });
});

describe('the webhook channel: the answer', () => {
  it('takes any 2xx and records the status and the start of the answer', async () => {
    const hook = await receiver();
    hook.answers.push({ status: 204 }, { status: 202, body: 'queued' });
    const { send, records } = channelOf({ url: hook.base });
    await send();
    await send();
    expect(records.map((one) => [one.statusCode, one.errorKind, one.excerpt])).toEqual([
      [204, null, ''],
      [202, null, 'queued'],
    ]);
  });

  it('does not follow a redirect: it is a temporary failure', async () => {
    const target = await receiver();
    const hook = await receiver();
    hook.answers.push({ status: 302, headers: { location: `${target.base}/elsewhere` } });
    const { send, records } = channelOf({ url: hook.base });
    const failure = await failureOf(send());
    expect(failure.permanent).toBe(false);
    expect(failure.message).toContain('302');
    expect(target.received).toHaveLength(0);
    expect(records[0]).toMatchObject({ statusCode: 302, errorKind: 'redirect' });
  });

  it('treats 4xx and 5xx as temporary failures with a kind of their own', async () => {
    const hook = await receiver();
    hook.answers.push({ status: 400 }, { status: 503, body: 'down' });
    const { send, records } = channelOf({ url: hook.base });
    expect((await failureOf(send())).permanent).toBe(false);
    expect((await failureOf(send())).permanent).toBe(false);
    expect(records.map((one) => one.errorKind)).toEqual(['client_error', 'server_error']);
    expect(records[1]?.excerpt).toBe('down');
  });

  it('passes Retry-After of a 429 on, in seconds or as a date', async () => {
    const hook = await receiver();
    hook.answers.push({ status: 429, headers: { 'retry-after': '30' } }, { status: 429 });
    const { send, records } = channelOf({ url: hook.base });
    expect((await failureOf(send())).retryAfterMs).toBe(30_000);
    expect((await failureOf(send())).retryAfterMs ?? null).toBeNull();
    expect(records.map((one) => one.errorKind)).toEqual(['rate_limited', 'rate_limited']);
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(retryAfterMs('Thu, 01 Jan 2026 00:01:00 GMT', now)).toBe(60_000);
    expect(retryAfterMs('Wed, 31 Dec 2025 00:00:00 GMT', now)).toBe(0);
    expect(retryAfterMs('999999999', now)).toBe(86_400_000);
    expect(retryAfterMs('soon', now)).toBeNull();
    expect(retryAfterMs(undefined, now)).toBeNull();
  });

  it('treats 410 as the end of the webhook: no retries and the connection goes off', async () => {
    const hook = await receiver();
    hook.answers.push({ status: 410 });
    const { send, records } = channelOf({ url: hook.base });
    const failure = await failureOf(send());
    expect(failure).toMatchObject({ permanent: true, disable: true });
    expect(records[0]).toMatchObject({ statusCode: 410, errorKind: 'gone' });
  });

  it('gives up on an answer that does not come in time', async () => {
    const hook = await receiver();
    hook.answers.push({ status: 200, delayMs: 1000 });
    const { send, records } = channelOf({ url: hook.base }, { timeoutMs: 100 });
    const failure = await failureOf(send());
    expect(failure.permanent).toBe(false);
    expect(records[0]).toMatchObject({ statusCode: null, errorKind: 'timeout' });
  });

  it('reads no more than 64 KiB of the answer', async () => {
    const hook = await receiver();
    hook.answers.push({ status: 500, body: 'x'.repeat(200_000) });
    const { send, records } = channelOf({ url: hook.base });
    await failureOf(send());
    expect(records[0]?.excerpt?.length).toBeLessThanOrEqual(1024);
  });

  it('reports a receiver that is not there without its address', async () => {
    const server = createHttp();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    const { send, records } = channelOf({ url: `http://127.0.0.1:${port}/secret-path` });
    const failure = await failureOf(send());
    expect(failure.permanent).toBe(false);
    expect(failure.message).not.toContain('secret-path');
    expect(records[0]).toMatchObject({ statusCode: null, errorKind: 'network' });
  });
});

/** A proxy that tunnels every CONNECT to the receiver, whatever host the client names. */
async function proxyTo(target: FakeReceiver) {
  const connects: string[] = [];
  const raw: string[] = [];
  const sockets = new Set<Socket>();
  const server = createHttp();
  server.on('connect', (request, client: Socket) => {
    connects.push(request.url ?? '');
    const port = Number(new URL(target.base).port);
    const upstream = connect(port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(client);
      client.pipe(upstream);
    });
    client.on('data', (chunk: Buffer) => raw.push(chunk.toString('latin1')));
    sockets.add(upstream);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => {
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections();
    server.close();
  });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, connects, raw };
}

describe('the webhook channel: the proxy', () => {
  it('tunnels an http address of another host with CONNECT; the proxy does not see the request', async () => {
    const hook = await receiver();
    const proxy = await proxyTo(hook);
    const { send } = channelOf(
      { url: 'http://hooks.internal.test:8080/path?token=abc' },
      { proxy: proxy.url },
    );
    await send();
    expect(proxy.connects).toEqual(['hooks.internal.test:8080']);
    expect(hook.received[0]?.path).toBe('/path?token=abc');
  });

  it('goes straight to loopback even when a proxy is set', async () => {
    const hook = await receiver();
    const proxy = await proxyTo(hook);
    const { send } = channelOf({ url: `${hook.base}/direct` }, { proxy: proxy.url });
    await send();
    expect(proxy.connects).toEqual([]);
    expect(hook.received).toHaveLength(1);
  });

  it('reports a proxy that refuses as a temporary failure', async () => {
    const server = createHttp();
    server.on('connect', (_request, client: Socket) => {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => {
      server.closeAllConnections();
      server.close();
    });
    const proxy = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { send, records } = channelOf({ url: 'http://hooks.internal.test/x' }, { proxy });
    const failure = await failureOf(send());
    expect(failure.permanent).toBe(false);
    expect(records[0]?.errorKind).toBe('proxy_refused');
  });
});
