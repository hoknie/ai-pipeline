import { existsSync, mkdirSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { QueueView, RunView } from '../../src/presentation/ipc/contract/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';
import { sweepUploads, UPLOAD_MAX_AGE_MS } from '../../src/presentation/web/uploads.ts';
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
  const headers = { 'x-aip-token': web.token ?? '' };
  const upload = (name: string, body: Uint8Array | string) =>
    fetch(`${base}/api/uploads`, {
      method: 'POST',
      headers: { ...headers, 'x-file-name': encodeURIComponent(name) },
      body,
    });
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const get = (path: string) => fetch(`${base}${path}`, { headers });
  return { h, base, upload, post, get };
}

const PNG = new Uint8Array(2048).fill(7);

describe('uploads of the panel', () => {
  it('keeps a file in the state directory and answers with its id, name and size', async () => {
    const { upload, h } = await setup();
    const response = await upload('скриншот.png', PNG);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { upload: string; fileName: string; size: number };
    expect(body).toMatchObject({ fileName: 'скриншот.png', size: 2048 });
    expect(readdirSync(join(h.state, 'uploads', body.upload))).toEqual(['скриншот.png']);
  });

  it('refuses a file over 20 MB with 413 and keeps nothing', async () => {
    const { upload, h } = await setup();
    const response = await upload('big.bin', new Uint8Array(21 * 1024 * 1024));
    expect(response.status).toBe(413);
    expect(existsSync(join(h.state, 'uploads'))).toBe(false);
  });

  it('refuses a missing or bad file name, and a wrong verb', async () => {
    const { upload, base, h } = await setup();
    expect((await upload('../x', 'a')).status).toBe(400);
    const none = await fetch(`${base}/api/uploads`, {
      method: 'POST',
      headers: { 'x-aip-token': web!.token ?? '' },
      body: 'a',
    });
    expect(none.status).toBe(400);
    const wrong = await fetch(`${base}/api/uploads`, {
      headers: { 'x-aip-token': web!.token ?? '' },
    });
    expect(wrong.status).toBe(405);
    expect(existsSync(join(h.state, 'uploads'))).toBe(false);
  });
});

describe('uploads in the requests of the queue', () => {
  it('turns an upload into an attachment of a new task and deletes the upload', async () => {
    const { upload, post, h } = await setup();
    const { upload: id } = (await (await upload('shot.png', PNG)).json()) as { upload: string };
    const response = await post('/api/queue/items', {
      pipeline: 'feature',
      task: 'работа',
      uploads: [id],
    });
    expect(response.status).toBe(200);
    const queue = (await response.json()) as QueueView;
    expect(queue.items[0]?.attachments).toMatchObject([{ fileName: 'shot.png', size: 2048 }]);
    expect(existsSync(join(h.state, 'uploads', id))).toBe(false);
  });

  it('refuses an unknown upload and creates no task', async () => {
    const { post, h } = await setup();
    for (const uploads of [['nope'], ['00000000-0000-4000-8000-000000000000']]) {
      const response = await post('/api/queue/items', { pipeline: 'feature', task: 'x', uploads });
      expect(response.status).toBe(400);
    }
    const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(queue.items).toEqual([]);
  });

  it('attaches an upload to a waiting item and detaches by name', async () => {
    const { upload, post, h } = await setup();
    const { upload: first } = (await (await upload('a.png', PNG)).json()) as { upload: string };
    const added = (await (
      await post('/api/queue/items', { pipeline: 'feature', task: 'x', uploads: [first] })
    ).json()) as QueueView;
    const item = added.items[0]!.id;
    const { upload: second } = (await (await upload('b.png', PNG)).json()) as { upload: string };
    const edited = (await (
      await post(`/api/queue/items/${item}`, { uploads: [second], detach: ['a.png'] })
    ).json()) as QueueView;
    expect(edited.items[0]?.attachments.map((file) => file.fileName)).toEqual(['b.png']);
  });
});

describe('download of an attachment of a run', () => {
  async function runWith(name: string, bytes: Uint8Array | string) {
    const context = await setup();
    const { upload, post, h } = context;
    const { upload: id } = (await (await upload(name, bytes)).json()) as { upload: string };
    h.script({ code: [{}] });
    const queued = (await (
      await post('/api/queue/items', { pipeline: 'feature', task: 'работа', uploads: [id] })
    ).json()) as QueueView;
    await h.call('queue_start', { repository: h.repo });
    const runView = (await h.call('status', {})) as RunView[];
    void queued;
    const runId = runView[0]?.id ?? '';
    const state = await h.waitFor(runId, (view) => view.attachments.length > 0);
    return { ...context, runId, id: state.attachments[0]!.id };
  }

  it('serves the file as a download with the name and nosniff', async () => {
    const { get, runId, id } = await runWith('spec.pdf', 'pdf-bytes');
    const response = await get(`/api/runs/${runId}/attachments/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain(
      'attachment; filename="spec.pdf"',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(await response.text()).toBe('pdf-bytes');
  });

  it('shows a picture inline with its type', async () => {
    const { get, runId, id } = await runWith('shot.png', PNG);
    const response = await get(`/api/runs/${runId}/attachments/${id}?inline=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toMatch(/^inline/);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it('shows a text file inline as plain text', async () => {
    const { get, runId, id } = await runWith('run.log', 'line');
    const response = await get(`/api/runs/${runId}/attachments/${id}?inline=1`);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('line');
  });

  it('refuses inline for SVG and other files, but downloads them', async () => {
    const svg = await runWith('logo.svg', '<svg onload="alert(1)"/>');
    expect((await svg.get(`/api/runs/${svg.runId}/attachments/${svg.id}?inline=1`)).status).toBe(
      400,
    );
    const download = await svg.get(`/api/runs/${svg.runId}/attachments/${svg.id}`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
  });

  it('answers 404 for an unknown attachment', async () => {
    const { get, runId } = await runWith('a.txt', 'a');
    expect((await get(`/api/runs/${runId}/attachments/nope`)).status).toBe(404);
  });
});

describe('sweepUploads', () => {
  it('deletes uploads older than a day and keeps fresh ones', () => {
    const root = join(mkdirSyncTemp(), 'uploads');
    for (const name of ['old', 'fresh']) mkdirSync(join(root, name), { recursive: true });
    const now = Date.now();
    const old = new Date(now - UPLOAD_MAX_AGE_MS - 60_000);
    utimesSync(join(root, 'old'), old, old);
    sweepUploads(root, now);
    expect(readdirSync(root)).toEqual(['fresh']);
    sweepUploads(join(root, 'missing'), now);
  });
});

function mkdirSyncTemp(): string {
  const directory = join(process.env.TMPDIR ?? '/tmp', `aip-sweep-${process.pid}-${Date.now()}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}
