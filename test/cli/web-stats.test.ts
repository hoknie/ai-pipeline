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

async function panel(): Promise<{ base: string; headers: Record<string, string> }> {
  const socket = join(mkdtempSync(join(tmpdir(), 'aip-web-stats-')), 'daemon.sock');
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
      const result = request.method === 'stats_clear' ? { removed: 3 } : { totals: { tasks: 0 } };
      connection.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    });
  });
  await new Promise<void>((resolve) => fake?.listen(socket, resolve));
  web = await startWebServer({
    socket,
    port: 0,
    token: 'stats-test-token',
    repository: '/selected-panel-repository',
    ensureDaemon: async () => ({ mismatch: null }) as never,
  });
  return { base: `http://127.0.0.1:${web.port}`, headers: { 'x-aip-token': web.token ?? '' } };
}

describe('GET and DELETE /api/stats', () => {
  it('asks the daemon for all projects and all time without any parameter', async () => {
    const { base, headers } = await panel();
    const response = await fetch(`${base}/api/stats`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ totals: { tasks: 0 } });
    expect(received).toEqual({ method: 'stats_report', params: {} });
  });

  it('passes the period and the project of a report', async () => {
    const { base, headers } = await panel();
    const response = await fetch(
      `${base}/api/stats?since=1000&until=2000&repository=%2Fwork%2Fapp`,
      {
        headers,
      },
    );
    expect(response.status).toBe(200);
    expect(received).toEqual({
      method: 'stats_report',
      params: { since: 1000, until: 2000, repository: '/work/app' },
    });
  });

  it.each(['since=abc', 'since=-5', 'until=1.5', 'since=9&until=3', 'repository=relative%2Fpath'])(
    'answers 400 to the query %s without asking the daemon',
    async (query) => {
      const { base, headers } = await panel();
      const response = await fetch(`${base}/api/stats?${query}`, { headers });
      expect(response.status).toBe(400);
      expect(received).toBeNull();
    },
  );

  it('clears the records of a project', async () => {
    const { base, headers } = await panel();
    const response = await fetch(`${base}/api/stats?repository=%2Fwork%2Fapp`, {
      method: 'DELETE',
      headers,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: 3 });
    expect(received).toEqual({ method: 'stats_clear', params: { repository: '/work/app' } });
  });

  it('answers 400 when the project to clear is missing', async () => {
    const { base, headers } = await panel();
    const response = await fetch(`${base}/api/stats`, { method: 'DELETE', headers });
    expect(response.status).toBe(400);
    expect(received).toBeNull();
  });

  it('requires the token', async () => {
    const { base } = await panel();
    expect((await fetch(`${base}/api/stats`)).status).toBe(401);
  });
});
