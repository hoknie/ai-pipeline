import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const asked = vi.hoisted(() => ({ calls: [] as unknown[][], answer: undefined as unknown }));

vi.mock('../../../src/presentation/ipc/client/index.ts', () => ({
  request: (...args: unknown[]) => {
    asked.calls.push(args);
    if (asked.answer instanceof Error) return Promise.reject(asked.answer);
    return Promise.resolve(asked.answer);
  },
}));

const { hookRoute } = await import('../../../src/presentation/web/hooks.ts');

let server: Server | null = null;

beforeEach(() => {
  asked.calls = [];
  asked.answer = undefined;
});

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = null;
});

async function send(
  body: string,
  options: { path?: string; method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown }> {
  server = createServer((incoming, response) => {
    hookRoute('/socket', incoming, response).catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: options.path ?? '/hooks/service-registry/c1',
        method: options.method ?? 'POST',
        headers: options.headers ?? {},
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) as unknown }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

describe('route of the events of the service registries', () => {
  it.each([
    [{ status: 'applied', item: 'q1' }, 200, { status: 'applied', item: 'q1' }],
    [{ status: 'applied', duplicate: true }, 200, { status: 'applied', duplicate: true }],
    [{ status: 'duplicate' }, 200, { status: 'duplicate' }],
    [{ status: 'ignored', reason: 'no_rule' }, 200, { status: 'ignored', reason: 'no_rule' }],
    [{ status: 'unknown_outcome' }, 202, { status: 'unknown_outcome' }],
    [{ status: 'unauthenticated' }, 401, { error: 'unauthenticated' }],
    [{ status: 'too_large' }, 413, { error: 'too_large' }],
    [{ status: 'operation_denied' }, 422, { error: 'operation_denied' }],
    [{ status: 'unavailable' }, 503, { error: 'unavailable' }],
  ])('shows %j as %i', async (answer, status, body) => {
    asked.answer = answer;
    expect(await send('{}')).toEqual({ status, body });
  });

  it('hands over the raw body and the three headers of the scheme, nothing else', async () => {
    asked.answer = { status: 'duplicate' };
    await send('{"a":1}', {
      headers: {
        'webhook-id': 'm1',
        'webhook-timestamp': '5',
        'webhook-signature': 'v1,AA==',
        authorization: 'Bearer x',
        cookie: 'aip_token=y',
      },
    });
    expect(asked.calls).toEqual([
      [
        '/socket',
        'integration_inbound',
        {
          kind: 'service-registry',
          connectionId: 'c1',
          body: Buffer.from('{"a":1}').toString('base64'),
          headers: { 'webhook-id': 'm1', 'webhook-timestamp': '5', 'webhook-signature': 'v1,AA==' },
        },
      ],
    ]);
  });

  it('answers 503 when the daemon is not there, without its error text', async () => {
    asked.answer = new Error('connect ECONNREFUSED /secret/path');
    expect(await send('{}')).toEqual({ status: 503, body: { error: 'unavailable' } });
  });

  it('does not call the daemon for a body above 1 MiB, a wrong verb or an unknown address', async () => {
    expect((await send('x'.repeat(1024 * 1024 + 1))).status).toBe(413);
    expect((await send('', { method: 'GET' })).status).toBe(405);
    expect((await send('{}', { path: '/hooks/other/c1' })).status).toBe(404);
    expect((await send('{}', { path: '/hooks/service-registry/a%20b' })).status).toBe(404);
    expect(asked.calls).toEqual([]);
  });
});
