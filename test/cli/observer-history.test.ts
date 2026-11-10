import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';

let web: WebServer | null = null;
let fake: Server | null = null;
let received: { method: string; params: Record<string, unknown> } | null = null;

afterEach(async () => {
  await web?.close();
  await new Promise<void>((resolve) => (fake ? fake.close(() => resolve()) : resolve()));
  web = null;
  fake = null;
  received = null;
});

async function panel(): Promise<{ base: string; token: string }> {
  const socket = join(mkdtempSync(join(tmpdir(), 'aip-observer-history-')), 'daemon.sock');
  fake = createServer((connection) => {
    connection.setEncoding('utf8');
    connection.on('data', (chunk: string) => {
      const request = JSON.parse(chunk.split('\n')[0] ?? '{}') as {
        id: number;
        method: string;
        params: Record<string, unknown>;
      };
      if (request.method === 'subscribe') return;
      received = { method: request.method, params: request.params };
      if (request.params.runtime === 'invalid-runtime') {
        connection.write(
          `${JSON.stringify({ id: request.id, ok: false, error: 'invalid runtime' })}\n`,
        );
        return;
      }
      connection.write(
        `${JSON.stringify({ id: request.id, ok: true, result: { items: [], nextCursor: null, limit: 20, projects: [], asOf: 1 } })}\n`,
      );
    });
  });
  await new Promise<void>((resolve) => fake?.listen(socket, resolve));
  web = await startWebServer({
    socket,
    port: 0,
    token: 'observer-history-test-token',
    repository: '/selected-panel-repository',
    ensureDaemon: async () => ({ mismatch: null }) as never,
  });
  return { base: `http://127.0.0.1:${web.port}`, token: web.token ?? '' };
}

describe('GET /api/observers/history', () => {
  it('works globally with no registered or selected repository and passes every filter', async () => {
    const { base, token } = await panel();
    const response = await fetch(
      `${base}/api/observers/history?repository=%2Fold&runtime=claude&model=m&result=done&from=1&to=2&limit=50&cursor=abc`,
      { headers: { 'x-aip-token': token } },
    );
    expect(response.status).toBe(200);
    expect(received).toEqual({
      method: 'observers_history',
      params: {
        repository: '/old',
        runtime: 'claude',
        model: 'm',
        result: 'done',
        from: 1,
        to: 2,
        limit: 50,
        cursor: 'abc',
      },
    });
  });

  it.each(['limit=21', 'from=1.5', 'from=3&to=2', 'to=9007199254740992'])(
    'rejects invalid query %s',
    async (query) => {
      const { base, token } = await panel();
      const response = await fetch(`${base}/api/observers/history?${query}`, {
        headers: { 'x-aip-token': token },
      });
      expect(response.status).toBe(400);
      expect(received).toBeNull();
    },
  );

  it('requires the configured panel token', async () => {
    const { base } = await panel();
    expect((await fetch(`${base}/api/observers/history`)).status).toBe(401);
  });

  it('returns 400 for a filter rejected by the history service', async () => {
    const { base, token } = await panel();
    const response = await fetch(`${base}/api/observers/history?runtime=invalid-runtime`, {
      headers: { 'x-aip-token': token },
    });
    expect(response.status).toBe(400);
  });
});
