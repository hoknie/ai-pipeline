import { afterEach, describe, expect, it } from 'vitest';

import type { QueueView } from '../../src/presentation/ipc/contract/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';
import { MANUAL_CONFIG, harness, type Harness } from '../daemon/harness.ts';

let h: Harness | null = null;
let web: WebServer | null = null;

afterEach(async () => {
  await web?.close();
  await h?.close();
  web = null;
  h = null;
});

async function setup() {
  h = await harness(MANUAL_CONFIG);
  web = await startWebServer({
    socket: h.socket,
    port: 0,
    repository: h.repo,
    stateDirectory: h.state,
  });
  const base = `http://127.0.0.1:${web.port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'x-aip-token': web!.token ?? '', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const queue = async () => (await h!.call('queue', { repository: h!.repo })) as QueueView;
  return { post, queue };
}

const task = { pipeline: 'feature', task: 'work' };

describe('links in the panel', () => {
  it('passes links of a new task and of an edit to the daemon', async () => {
    const { post, queue } = await setup();
    const first = (await (await post('/api/queue/items', task)).json()) as QueueView;
    const a = first.items[0]!.id;
    const second = await post('/api/queue/items', {
      ...task,
      links: [{ kind: 'related', target: a }],
    });
    expect(second.status).toBe(200);
    let view = await queue();
    expect(view.items[1]!.links).toEqual([expect.objectContaining({ kind: 'related', id: a })]);
    const edited = await post(`/api/queue/items/${view.items[1]!.id}`, { links: [] });
    expect(edited.status).toBe(200);
    view = await queue();
    expect(view.items[1]!.links).toEqual([]);
  });

  it('links and unlinks two tasks through /api/tasks/link and /api/tasks/unlink', async () => {
    const { post, queue } = await setup();
    await post('/api/queue/items', task);
    await post('/api/queue/items', task);
    const [a, b] = (await queue()).items.map((item) => item.id) as [string, string];
    const linked = await post('/api/tasks/link', { source: b, kind: 'duplicates', target: a });
    expect(linked.status).toBe(200);
    expect((await queue()).items[0]!.linkedBy).toEqual([
      expect.objectContaining({ kind: 'duplicates', id: b }),
    ]);
    const unlinked = await post('/api/tasks/unlink', { source: b, kind: 'duplicates', target: a });
    expect(unlinked.status).toBe(200);
    expect((await queue()).items[0]!.linkedBy).toEqual([]);
    const bad = await post('/api/tasks/link', { source: b, kind: 'bogus', target: a });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});
