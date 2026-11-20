import { afterEach, describe, expect, it } from 'vitest';

import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';
import { harness, type Harness } from '../daemon/harness.ts';

let current: Harness | null = null;
let web: WebServer | null = null;

afterEach(async () => {
  await web?.close();
  await current?.close();
  web = null;
  current = null;
});

describe('the author parameter of the panel API in the local mode', () => {
  it('answers 400 for every list and the report, and lists as before without it', async () => {
    current = await harness();
    web = await startWebServer({
      socket: current.socket,
      port: 0,
      token: 'local-author-token',
      repository: current.repo,
    });
    const base = `http://127.0.0.1:${web.port}`;
    const headers = { 'x-aip-token': web.token ?? '' };
    for (const path of [
      '/api/runs?author=me',
      '/api/finished-runs?author=me',
      `/api/queue?author=me&repository=${encodeURIComponent(current.repo)}`,
      '/api/stats?author=me',
    ]) {
      const answer = await fetch(`${base}${path}`, { headers });
      expect(answer.status, path).toBe(400);
    }
    for (const path of ['/api/runs', '/api/finished-runs', '/api/stats']) {
      expect((await fetch(`${base}${path}`, { headers })).status, path).toBe(200);
    }
    const stats = (await (await fetch(`${base}/api/stats`, { headers })).json()) as {
      byAuthor?: unknown;
    };
    expect(stats.byAuthor).toBeUndefined();
  });
});
