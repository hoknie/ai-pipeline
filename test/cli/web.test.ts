import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDaemonPanel, startDaemonPanel } from '../../src/cli/web/daemon-panel.ts';
import { readPanelState, writePanelState } from '../../src/cli/web/state.ts';
import { startWebServer, webTokenFromEnv, type WebServer } from '../../src/cli/web/server.ts';
import type { GroupView, QueueView, RunCreated, RunView } from '../../src/protocol/index.ts';
import { MANUAL_CONFIG, harness, startRun, type Harness } from '../daemon/harness.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';

let h: Harness | null = null;
let web: WebServer | null = null;

afterEach(async () => {
  await web?.close();
  await h?.close();
  web = null;
  h = null;
});

async function setup(): Promise<{ h: Harness; web: WebServer; base: string }> {
  h = await harness(MANUAL_CONFIG);
  web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
  return { h, web, base: `http://127.0.0.1:${web.port}` };
}

function authed(web: WebServer, extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-aip-token': web.token ?? '', ...extra };
}

const JSON_TYPE = { 'content-type': 'application/json' };

describe('aip web', () => {
  it('serves the built page only with the token, its assets with a long cache', async () => {
    const assets = mkdtempSync(join(tmpdir(), 'aip-assets-'));
    mkdirSync(join(assets, 'assets'));
    writeFileSync(
      join(assets, 'index.html'),
      '<!doctype html><title>aip</title><div id="root"></div>',
    );
    writeFileSync(join(assets, 'assets', 'index-abc.js'), 'console.log(1)');
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({ socket: h.socket, port: 0, assets });
    const base = `http://127.0.0.1:${web.port}`;
    expect((await fetch(`${base}/`)).status).toBe(401);
    expect((await fetch(`${base}/?token=wrong`)).status).toBe(401);
    const page = await fetch(`${base}/?token=${web.token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('set-cookie')).toContain('HttpOnly');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await page.text()).toContain('<div id="root">');
    const cookie = page.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect((await fetch(`${base}/`, { headers: { cookie } })).status).toBe(200);
    const script = await fetch(`${base}/assets/index-abc.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(script.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/assets/..%2f..%2findex.html`)).status).toBe(404);
  });

  it('explains how to build the panel when the build is missing', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({
      socket: h.socket,
      port: 0,
      assets: mkdtempSync(join(tmpdir(), 'aip-empty-')),
    });
    const page = await fetch(`http://127.0.0.1:${web.port}/?token=${web.token}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('npm run build');
  });

  it('rejects the API without a token, with a foreign Host or Origin', async () => {
    const { web, base } = await setup();
    expect((await fetch(`${base}/api/runs`)).status).toBe(401);
    expect((await fetch(`${base}/api/runs`, { headers: authed(web) })).status).toBe(200);
    expect(
      (await fetch(`${base}/api/runs`, { headers: authed(web, { origin: 'http://evil.example' }) }))
        .status,
    ).toBe(403);
    const response = await new Promise<number>((resolve, reject) => {
      import('node:http').then(({ request }) => {
        request(
          {
            host: '127.0.0.1',
            port: web.port,
            path: '/api/runs',
            headers: { host: 'evil.example', ...authed(web) },
          },
          (res) => resolve(res.statusCode ?? 0),
        )
          .on('error', reject)
          .end();
      }, reject);
    });
    expect(response).toBe(403);
  });

  it('lists runs and shows a group', async () => {
    const { h, web, base } = await setup();
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.finished);
    const runs = (await (
      await fetch(`${base}/api/runs`, { headers: authed(web) })
    ).json()) as RunView[];
    expect(runs.map((run) => run.id)).toContain(runId);
    const one = (await (
      await fetch(`${base}/api/runs/${runId}`, { headers: authed(web) })
    ).json()) as RunView;
    expect(one.groups[0]?.slug).toBe('login');
    const group = (await (
      await fetch(`${base}/api/runs/${runId}/groups/login?tail=5`, { headers: authed(web) })
    ).json()) as GroupView;
    expect(group.attempts.length).toBeGreaterThan(0);
    expect(
      (await fetch(`${base}/api/runs/${runId}/groups/login?tail=0`, { headers: authed(web) }))
        .status,
    ).toBe(400);
    expect((await fetch(`${base}/api/runs/nope`, { headers: authed(web) })).status).toBe(404);
    expect(
      (await fetch(`${base}/api/runs/${runId}/groups/nope`, { headers: authed(web) })).status,
    ).toBe(404);
    expect((await fetch(`${base}/api/runs?tail=x`, { headers: authed(web) })).status).toBe(200);
  });

  it('routes retry and apply with validation', async () => {
    const { h, web, base } = await setup();
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.finished);
    const post = (path: string, body: unknown) =>
      fetch(`${base}/api/runs/${runId}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });

    expect((await post('/apply', { force: 'yes' })).status).toBe(400);
    expect((await post('/apply', { groups: [''] })).status).toBe(400);
    const applied = await post('/apply', { force: true });
    expect(applied.status).toBe(200);
    const result = (await applied.json()) as { runId: string; groups: unknown[] };
    expect(result.runId).toBe(runId);
    expect(Array.isArray(result.groups)).toBe(true);

    const retry = await post('/groups/login/retry', {});
    expect(retry.status).toBe(400);
    expect(((await retry.json()) as { error: string }).error).toContain(
      'retry needs failed, cancelled or conflict',
    );
    const missing = await post('/groups/nope/retry', {});
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toContain('unknown group');
  });

  it('streams a snapshot over SSE', async () => {
    const { h, web, base } = await setup();
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, {
      headers: authed(web),
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 10_000;
    while (!text.includes('"snapshot"') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    controller.abort();
    expect(text).toContain('"event":"snapshot"');
    expect(text).toContain(runId);
  });

  it('tells the panel that the daemon runs an older build', async () => {
    const old = { version: '0.0.1', fingerprint: 'old', builtAt: 1 };
    h = await harness(MANUAL_CONFIG, {}, { build: old });
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${web.port}/api/events`, {
      headers: authed(web),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 10_000;
    while (!text.includes('"snapshot"') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    controller.abort();
    const snapshot = JSON.parse(
      text
        .split('\n')
        .find((line) => line.includes('"snapshot"'))!
        .slice('data: '.length),
    ) as { daemon: unknown };
    expect(snapshot.daemon).toMatchObject({
      outdated: 'daemon',
      pid: process.pid,
      daemon: old,
      busy: false,
    });
  });

  it('keeps relaying runs when the daemon sends queue events', async () => {
    const { h, web, base } = await setup();
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, {
      headers: authed(web),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const read = async (until: string) => {
      const deadline = Date.now() + 10_000;
      while (!text.includes(until) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await read('"snapshot"');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_add', { repository: h.repo, workflow: 'feature', task: 'x' });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await read(runId);
    controller.abort();
    expect(text).toContain(`"id":"${runId}"`);
  });

  it('relays the tags event and keeps tags in the snapshot', async () => {
    const { h, web, base } = await setup();
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, {
      headers: authed(web),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const read = async (until: string) => {
      const deadline = Date.now() + 10_000;
      while (!text.includes(until) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await read('"snapshot"');
    await h.call('tag_add', { name: 'auth' });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await read(runId);
    controller.abort();
    expect(text).toContain(`"id":"${runId}"`);
    expect(text).toContain('"event":"tags"');
    expect(text).toContain('"name":"auth"');
  });

  it('serves the tags API with the same protection as the rest', async () => {
    const { h, web, base } = await setup();
    const post = (path: string, body: unknown, headers = authed(web, JSON_TYPE)) =>
      fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const names = async () =>
      (
        (await (await fetch(`${base}/api/tags`, { headers: authed(web) })).json()) as {
          name: string;
          color: string;
        }[]
      ).map((tag) => `${tag.name}:${tag.color}`);
    expect((await fetch(`${base}/api/tags`)).status).toBe(401);
    expect((await post('/api/tags', { name: 'auth' }, JSON_TYPE)).status).toBe(401);
    expect(await names()).toEqual([]);

    expect((await post('/api/tags', { name: 'auth', color: 'red' })).status).toBe(200);
    expect((await post('/api/tags', { name: 'AUTH' })).status).toBe(400);
    expect((await post('/api/tags', { name: '  ' })).status).toBe(400);
    expect(await names()).toEqual(['auth:red']);

    expect(
      (await post('/api/tags/edit', { tag: 'auth', name: 'login', color: 'blue' })).status,
    ).toBe(200);
    expect((await post('/api/tags/edit', { tag: 'nope', color: 'blue' })).status).toBe(400);
    expect((await post('/api/tags/edit', { tag: 'login' })).status).toBe(400);
    expect(await names()).toEqual(['login:blue']);

    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    const set = await post(`/api/runs/${runId}/tags`, { add: ['login'] });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { tags: { name: string }[] }).tags.map((t) => t.name)).toEqual([
      'login',
    ]);
    expect((await post(`/api/runs/${runId}/tags`, { add: ['nope'] })).status).toBe(400);
    expect((await post(`/api/runs/${runId}/tags`, {})).status).toBe(400);
    expect((await post('/api/runs/unknown/tags', { add: ['login'] })).status).toBe(404);
    const cleared = await post(`/api/runs/${runId}/tags`, { remove: ['login'] });
    expect(((await cleared.json()) as { tags: unknown[] }).tags).toEqual([]);

    expect((await post('/api/tags/remove', { tag: 'nope' })).status).toBe(400);
    expect((await post('/api/tags/remove', { tag: 'login' })).status).toBe(200);
    expect(await names()).toEqual([]);
  });

  it('passes tags of a queued task through the queue API', async () => {
    const { web, base } = await setup();
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    await post('/api/tags', { name: 'auth' });
    await post('/api/tags', { name: 'ui' });
    const added = (await (
      await post('/api/queue/items', { workflow: 'feature', task: 'x', tags: ['auth', 'ui'] })
    ).json()) as QueueView & { item: string };
    expect(added.items[0]?.tags.map((t) => t.name)).toEqual(['auth', 'ui']);
    const edited = (await (
      await post(`/api/queue/items/${added.item}`, { tags: [] })
    ).json()) as QueueView;
    expect(edited.items[0]?.tags).toEqual([]);
    expect(
      (await post('/api/queue/items', { workflow: 'feature', task: 'x', tags: ['nope'] })).status,
    ).toBe(400);
  });

  it('serves the queue API with the same protection as the rest', async () => {
    const { h, web, base } = await setup();
    const post = (path: string, body: unknown, headers = authed(web, JSON_TYPE)) =>
      fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const read = async () =>
      (await (await fetch(`${base}/api/queue`, { headers: authed(web) })).json()) as QueueView;
    expect((await fetch(`${base}/api/queue`)).status).toBe(401);
    expect(
      (await post('/api/queue/items', { workflow: 'feature', task: 'x' }, JSON_TYPE)).status,
    ).toBe(401);
    expect((await read()).items).toEqual([]);
    expect((await fetch(`${base}/api/queue/items`, { headers: authed(web) })).status).toBe(405);
    expect((await fetch(`${base}/api/queue/start`, { headers: authed(web) })).status).toBe(405);
    expect((await post('/api/queue', {})).status).toBe(405);

    const added = await post('/api/queue/items', { workflow: 'feature', task: 'первая' });
    expect(added.status).toBe(200);
    await post('/api/queue/items', { workflow: 'feature', task: 'вторая', title: 'Вторая' });
    const third = (await (
      await post('/api/queue/items', {
        workflow: 'feature',
        groups: [{ title: 'a', task: 'b' }],
        // a body cannot choose another repository
        repository: '/elsewhere',
      })
    ).json()) as QueueView & { item: string };
    expect(third.repository).toBe(h.repo);
    expect((await read()).items.map((item) => item.task)).toEqual(['первая', 'вторая', null]);

    const moved = await post(`/api/queue/items/${third.item}`, { position: 1 });
    expect(moved.status).toBe(200);
    expect((await read()).items[0]?.id).toBe(third.item);
    const edited = await post(`/api/queue/items/${third.item}`, { task: 'текст' });
    expect(edited.status).toBe(200);

    for (const [path, body] of [
      ['/api/queue/items', { workflow: 'feature', task: '  ' }],
      ['/api/queue/items', { workflow: 'feature' }],
      ['/api/queue/items', { workflow: 'nope', task: 'x' }],
      ['/api/queue/settings', { parallel: 0 }],
      ['/api/queue/start', { parallel: 21 }],
    ] as const) {
      const bad = await post(path, body);
      expect(bad.status, path).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toBeTruthy();
    }

    const missing = await post('/api/queue/items/q-zzzz/remove', {});
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe('unknown queue item');
    expect((await post('/api/queue/items/q-zzzz', { task: 'x' })).status).toBe(404);
    expect((await post('/api/queue/items/q-zzzz/run', {})).status).toBe(404);

    const settings = (await (
      await post('/api/queue/settings', { parallel: 2 })
    ).json()) as QueueView;
    expect(settings).toMatchObject({ parallel: 2, status: 'stopped' });
    const removed = (await (
      await post(`/api/queue/items/${third.item}/remove`, {})
    ).json()) as QueueView;
    expect(removed.items).toHaveLength(2);
    const now = await post(`/api/queue/items/${removed.items[1]!.id}/run`, {});
    expect(now.status).toBe(200);
    expect(((await now.json()) as RunCreated).runId).toBeTruthy();
    const started = (await (await post('/api/queue/start', {})).json()) as QueueView;
    expect(started.status).toBe('running');
    const paused = (await (await post('/api/queue/pause', {})).json()) as QueueView;
    expect(paused.status).toBe('stopped');
  });

  it('relays queue events and keeps queues in the snapshot of new clients', async () => {
    const { h, web, base } = await setup();
    const open = async () => {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/events`, {
        headers: authed(web),
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      return {
        controller,
        async until(needle: string) {
          const deadline = Date.now() + 10_000;
          while (!text.includes(needle) && Date.now() < deadline) {
            const { value, done } = await reader.read();
            if (done) break;
            text += decoder.decode(value);
          }
          return text;
        },
      };
    };
    const first = await open();
    await first.until('"snapshot"');
    await h.call('queue_add', { repository: h.repo, workflow: 'feature', task: 'из терминала' });
    expect(await first.until('"event":"queue"')).toContain('из терминала');
    first.controller.abort();
    const second = await open();
    const text = await second.until('из терминала');
    second.controller.abort();
    expect(text).toContain('"event":"snapshot"');
    expect(text).toMatch(/"queues":\[\{[^]*из терминала/);
  });

  it('answers a question and cancels through POST', async () => {
    const { h, web, base } = await setup();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'Which auth?' }, { delayMs: 20_000 }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    const waiting = await h.waitFor(runId, (run) =>
      run.groups.some((group) => group.status === 'needs_human'),
    );
    const asking = waiting.groups.find((group) => group.status === 'needs_human')!;
    const groupBase = `${base}/api/runs/${runId}/groups/${asking.slug}`;

    expect(
      (await fetch(`${groupBase}/answer`, { method: 'POST', headers: authed(web), body: '{}' }))
        .status,
    ).toBe(415);
    expect(
      (
        await fetch(`${groupBase}/answer`, {
          method: 'POST',
          headers: authed(web, JSON_TYPE),
          body: JSON.stringify({ answer: '  ' }),
        })
      ).status,
    ).toBe(400);
    const answered = await fetch(`${groupBase}/answer`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ answer: 'Use OAuth' }),
    });
    expect(answered.status).toBe(200);
    const after = await h.waitFor(runId, (run) =>
      run.groups.every((group) => group.status !== 'needs_human'),
    );
    expect(after.groups.find((group) => group.slug === asking.slug)?.status).not.toBe(
      'needs_human',
    );

    const cancelled = await fetch(`${base}/api/runs/${runId}/cancel`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: '{}',
    });
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as RunView).id).toBe(runId);
  });

  it('reports daemon errors as JSON with a 4xx status', async () => {
    const { web, base } = await setup();
    const response = await fetch(`${base}/api/runs/missing/cancel`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: '{}',
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(((await response.json()) as { error: string }).error).toBeTruthy();
    expect((await fetch(`${base}/api/unknown`, { headers: authed(web) })).status).toBe(404);
    const bad = await fetch(`${base}/api/runs/%E0%A4%A/cancel`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: '{}',
    });
    expect(bad.status).toBe(400);
  });

  it('refuses to listen on a non-loopback host', async () => {
    await expect(
      startWebServer({ socket: '/tmp/none.sock', host: '0.0.0.0', port: 0 }),
    ).rejects.toThrow(/loopback/);
  });

  it('serves the transcript of an attempt with a cursor and validates the query', async () => {
    const { h, web, base } = await setup();
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.finished);
    const path = `${base}/api/runs/${runId}/groups/login/transcript`;
    const first = await fetch(`${path}?seq=1`, { headers: authed(web) });
    expect(first.status).toBe(200);
    const transcript = (await first.json()) as {
      seq: number;
      cursor: number;
      running: boolean;
      entries: { kind: string; verdict?: string; costUsd?: number }[];
    };
    expect(transcript).toMatchObject({ seq: 1, running: false });
    expect(transcript.entries.find((entry) => entry.kind === 'result')).toMatchObject({
      verdict: 'done',
      costUsd: 0.01,
    });
    const rest = await fetch(`${path}?seq=1&after=${transcript.cursor}`, { headers: authed(web) });
    expect(((await rest.json()) as { entries: unknown[] }).entries).toEqual([]);
    expect((await fetch(`${path}?after=-1`, { headers: authed(web) })).status).toBe(400);
    expect((await fetch(`${path}?seq=99`, { headers: authed(web) })).status).toBe(404);
  });

  it('serves the workflows of the repository, and the errors of a broken configuration', async () => {
    const { h, web, base } = await setup();
    const ok = await fetch(`${base}/api/workflows?repository=${encodeURIComponent(h.repo)}`, {
      headers: authed(web),
    });
    expect(ok.status).toBe(200);
    const view = (await ok.json()) as {
      workflows: { id: string; steps: { id: string }[] }[];
      errors: unknown[];
    };
    expect(view.errors).toEqual([]);
    expect(view.workflows.map((workflow) => workflow.id)).toEqual(['feature']);
    expect(view.workflows[0]?.steps.map((entry) => entry.id)).toEqual(['code', 'review']);
    writeConfigDirectory(h.repo, 'swarm:\n  max: 0\n');
    const broken = (await (
      await fetch(`${base}/api/workflows?repository=${encodeURIComponent(h.repo)}`, {
        headers: authed(web),
      })
    ).json()) as { workflows: unknown[]; errors: { path: string }[] };
    expect(broken.workflows).toEqual([]);
    expect(broken.errors).toContainEqual(
      expect.objectContaining({ path: 'swarm.max', file: join(h.repo, 'aip', 'settings.yaml') }),
    );
  });
});

describe('aip web catalog', () => {
  it('serves the catalog of the chosen repository, fresh on every request, only with the token', async () => {
    const { h, web, base } = await setup();
    expect((await fetch(`${base}/api/config/catalog`)).status).toBe(401);
    const read = async () =>
      (await (await fetch(`${base}/api/config/catalog`, { headers: authed(web) })).json()) as {
        repository: string;
        runtimes: { claude: { skills: { name: string }[] } };
      };
    const first = await read();
    expect(first.repository).toBe(h.repo);
    expect(first.runtimes.claude.skills.map((skill) => skill.name)).not.toContain('fresh');
    mkdirSync(join(h.repo, '.claude', 'skills', 'fresh'), { recursive: true });
    writeFileSync(join(h.repo, '.claude', 'skills', 'fresh', 'SKILL.md'), 'x');
    expect((await read()).runtimes.claude.skills.map((skill) => skill.name)).toContain('fresh');
  });
});

describe('aip web configuration editor', () => {
  async function editor(): Promise<{ h: Harness; web: WebServer; base: string }> {
    h = await harness(MANUAL_CONFIG, {
      HOME: mkdtempSync(join(tmpdir(), 'aip-web-home-')),
    });
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    return { h, web, base: `http://127.0.0.1:${web.port}` };
  }

  const put = (web: WebServer, base: string, id: string, body: unknown, extra = {}) =>
    fetch(`${base}/api/config/specialists/${id}`, {
      method: 'PUT',
      headers: authed(web, { ...JSON_TYPE, ...extra }),
      body: JSON.stringify(body),
    });

  it('requires the token and a matching Origin for writes', async () => {
    const { h, web, base } = await editor();
    const body = { value: { name: 'X' }, revision: null };
    const anonymous = await fetch(`${base}/api/config/specialists/qa`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(body),
    });
    expect(anonymous.status).toBe(401);
    expect((await put(web, base, 'qa', body, { origin: 'http://evil.example' })).status).toBe(403);
    expect(
      (
        await fetch(`${base}/api/config/specialists/coder?revision=x`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(401);
    expect(existsSync(join(h.repo, 'aip', 'specialists', 'qa.yaml'))).toBe(false);
  });

  it('serves the catalog of the repository, live and behind the token', async () => {
    const { h, web, base } = await editor();
    const read = async () =>
      (await (await fetch(`${base}/api/config/catalog`, { headers: authed(web) })).json()) as {
        repository: string;
        runtimes: { claude: { skills: { name: string }[]; tools: { name: string }[] } };
      };
    const first = await read();
    expect(first.repository).toBe(h.repo);
    expect(first.runtimes.claude.tools.map((t) => t.name)).toContain('WebFetch');
    expect(first.runtimes.claude.skills.map((s) => s.name)).not.toContain('fresh-skill');
    mkdirSync(join(h.repo, '.claude', 'skills', 'fresh-skill'), { recursive: true });
    writeFileSync(join(h.repo, '.claude', 'skills', 'fresh-skill', 'SKILL.md'), '');
    expect((await read()).runtimes.claude.skills.map((s) => s.name)).toContain('fresh-skill');
    expect((await fetch(`${base}/api/config/catalog`)).status).toBe(401);

    const other = realpathSync(mkdtempSync(join(tmpdir(), 'aip-web-other-')));
    execFileSync('git', ['init', '-q', '-b', 'main', other]);
    writeConfigDirectory(other, MANUAL_CONFIG);
    const response = await fetch(
      `${base}/api/config/catalog?repository=${encodeURIComponent(other)}`,
      { headers: authed(web) },
    );
    expect(response.status).toBe(200);
    const foreign = (await response.json()) as Awaited<ReturnType<typeof read>>;
    expect(foreign.repository).toBe(other);
    expect(foreign.runtimes.claude.skills.map((s) => s.name)).not.toContain('fresh-skill');
  });

  it('reads the editor view and writes, conflicts and deletes', async () => {
    const { h, web, base } = await editor();
    const view = (await (await fetch(`${base}/api/config`, { headers: authed(web) })).json()) as {
      specialists: { slug: string; revision: string | null; raw: Record<string, unknown> }[];
    };
    const coder = view.specialists.find((specialist) => specialist.slug === 'coder')!;
    const file = join(h.repo, 'aip', 'specialists', 'coder.yaml');

    const invalid = await put(web, base, 'coder', {
      value: { ...coder.raw, permissions: 'admin' },
      revision: coder.revision,
    });
    expect(invalid.status).toBe(422);
    const rejected = (await invalid.json()) as { errors: { path: string }[] };
    expect(rejected.errors.map((error) => error.path)).toContain(
      'swarm.specialists.coder.permissions',
    );

    const ok = await put(web, base, 'coder', {
      value: { ...coder.raw, model: 'opus' },
      revision: coder.revision,
    });
    expect(ok.status).toBe(200);
    expect(readFileSync(file, 'utf8')).toContain('model: opus');

    const stale = await put(web, base, 'coder', { value: { name: 'X' }, revision: coder.revision });
    expect(stale.status).toBe(409);
    expect(readFileSync(file, 'utf8')).toContain('model: opus');

    expect(
      (await put(web, base, '..%2Fsettings', { value: { name: 'X' }, revision: null })).status,
    ).toBe(400);
    expect((await put(web, base, 'qa', { value: 'nope', revision: null })).status).toBe(400);

    expect((await put(web, base, 'qa', { value: { name: 'QA' }, revision: null })).status).toBe(
      200,
    );
    const created = (await (
      await fetch(`${base}/api/config`, { headers: authed(web) })
    ).json()) as { specialists: { slug: string; revision: string }[] };
    const qa = created.specialists.find((specialist) => specialist.slug === 'qa')!;
    const used = await fetch(
      `${base}/api/config/specialists/reviewer?revision=${created.specialists.find((s) => s.slug === 'reviewer')!.revision}`,
      { method: 'DELETE', headers: authed(web) },
    );
    expect(used.status).toBe(422);
    expect(((await used.json()) as { references: unknown[] }).references).toEqual([
      { workflow: 'feature', step: 'review' },
    ]);
    const removed = await fetch(`${base}/api/config/specialists/qa?revision=${qa.revision}`, {
      method: 'DELETE',
      headers: authed(web),
    });
    expect(removed.status).toBe(200);
    expect(existsSync(join(h.repo, 'aip', 'specialists', 'qa.yaml'))).toBe(false);
    expect(
      (await fetch(`${base}/api/config/specialists/qa`, { method: 'DELETE', headers: authed(web) }))
        .status,
    ).toBe(400);
  });

  it('writes and deletes on the global level and rejects an unknown level', async () => {
    const { h, web, base } = await editor();
    const file = join(h.repo, '..', 'xdg', 'aip', 'specialists', 'qa.yaml');
    const created = await put(web, base, 'qa', {
      value: { name: 'QA' },
      revision: null,
      level: 'global',
    });
    expect(created.status).toBe(200);
    expect(readFileSync(file, 'utf8')).toContain('name: QA');
    expect(existsSync(join(h.repo, 'aip', 'specialists', 'qa.yaml'))).toBe(false);

    const view = (await (await fetch(`${base}/api/config`, { headers: authed(web) })).json()) as {
      specialists: { slug: string; sources: { global?: { revision: string } } }[];
    };
    const revision = view.specialists.find((s) => s.slug === 'qa')!.sources.global!.revision;
    const url = `${base}/api/config/specialists/qa?revision=${revision}`;
    expect(
      (await fetch(`${url}&level=system`, { method: 'DELETE', headers: authed(web) })).status,
    ).toBe(400);
    expect(existsSync(file)).toBe(true);
    expect(
      (await put(web, base, 'qa2', { value: { name: 'X' }, revision: null, level: 'system' }))
        .status,
    ).toBe(400);
    expect(
      (await fetch(`${url}&level=global`, { method: 'DELETE', headers: authed(web) })).status,
    ).toBe(200);
    expect(existsSync(file)).toBe(false);
  });

  it('previews, writes and deletes workflows', async () => {
    const { h, web, base } = await editor();
    const steps = [
      { id: 'code', specialist: 'coder' },
      { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 2 } },
    ];
    const file = join(h.repo, 'aip', 'workflows', 'feature.yaml');
    const before = readFileSync(file, 'utf8');
    const post = (value: unknown, headers: Record<string, string> = authed(web, JSON_TYPE)) =>
      fetch(`${base}/api/config/workflows/feature/preview`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ value }),
      });
    expect((await post({ steps }, JSON_TYPE)).status).toBe(401);
    const good = await post({ steps: [...steps, { id: 'docs', specialist: 'coder' }] });
    expect(good.status).toBe(200);
    const preview = (await good.json()) as { topology: { steps: { id: string }[] }; errors: [] };
    expect(preview.topology.steps.map((step) => step.id)).toEqual(['code', 'review', 'docs']);
    const bad = (await (await post({ steps: [{ id: 'a', specialist: 'nobody' }] })).json()) as {
      topology: null;
      errors: { path: string }[];
    };
    expect(bad.topology).toBeNull();
    expect(bad.errors[0]?.path).toBe('swarm.workflows.feature.steps[0].specialist');
    expect(readFileSync(file, 'utf8')).toBe(before);

    const view = (await (await fetch(`${base}/api/config`, { headers: authed(web) })).json()) as {
      workflows: { id: string; revision: string }[];
    };
    const feature = view.workflows.find((workflow) => workflow.id === 'feature')!;
    const put = (revision: string | null, value: unknown) =>
      fetch(`${base}/api/config/workflows/feature`, {
        method: 'PUT',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify({ value, revision }),
      });
    expect(
      (await put(feature.revision, { steps: [{ id: 'a', specialist: 'nobody' }] })).status,
    ).toBe(422);
    expect((await put('stale', { steps })).status).toBe(409);
    expect((await put(feature.revision, { steps: steps.slice(0, 1) })).status).toBe(200);
    expect(readFileSync(file, 'utf8')).not.toContain('review');
    const fresh = (await (await fetch(`${base}/api/config`, { headers: authed(web) })).json()) as {
      workflows: { id: string; revision: string }[];
    };
    const removed = await fetch(
      `${base}/api/config/workflows/feature?revision=${fresh.workflows[0]!.revision}`,
      { method: 'DELETE', headers: authed(web) },
    );
    expect(removed.status).toBe(200);
    expect(existsSync(file)).toBe(false);
  });
});

describe('aip web repository parameter', () => {
  function secondRepository(plain = false): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aip-web-second-')));
    if (plain) return dir;
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    writeConfigDirectory(dir, MANUAL_CONFIG);
    return dir;
  }
  const enc = encodeURIComponent;

  it('reads and changes the queue of the repository from the query string', async () => {
    const { h, web, base } = await setup();
    const second = secondRepository();
    const get = async (query: string) =>
      (await (
        await fetch(`${base}/api/queue${query}`, { headers: authed(web) })
      ).json()) as QueueView;
    expect((await get(`?repository=${enc(second)}`)).repository).toBe(second);
    expect((await get('')).repository).toBe(h.repo);

    const paused = await fetch(`${base}/api/queue/pause?repository=${enc(second)}`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ repository: '/elsewhere' }),
    });
    expect(paused.status).toBe(200);
    expect(((await paused.json()) as QueueView).repository).toBe(second);

    const added = await fetch(`${base}/api/queue/items?repository=${enc(second)}`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ workflow: 'feature', task: 'x', repository: h.repo }),
    });
    expect(((await added.json()) as QueueView).repository).toBe(second);
    expect((await get('')).items).toEqual([]);
    expect((await get(`?repository=${enc(second)}`)).items).toHaveLength(1);
  });

  it('writes the configuration only into the chosen repository', async () => {
    const { h, web, base } = await setup();
    const second = secondRepository();
    const view = (await (
      await fetch(`${base}/api/config?repository=${enc(second)}`, { headers: authed(web) })
    ).json()) as { specialists: { slug: string; raw: Record<string, unknown> }[] };
    const coder = view.specialists.find((specialist) => specialist.slug === 'coder')!;
    const written = await fetch(`${base}/api/config/specialists/writer?repository=${enc(second)}`, {
      method: 'PUT',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ value: coder.raw, revision: null }),
    });
    expect(written.status).toBe(200);
    expect(existsSync(join(second, 'aip', 'specialists', 'writer.yaml'))).toBe(true);
    expect(existsSync(join(h.repo, 'aip', 'specialists', 'writer.yaml'))).toBe(false);
  });

  it('rejects relative paths and paths outside git', async () => {
    const { web, base } = await setup();
    const relative = await fetch(`${base}/api/config?repository=relative`, {
      headers: authed(web),
    });
    expect(relative.status).toBe(400);
    expect(((await relative.json()) as { error: string }).error).toBe(
      'repository must be an absolute path',
    );
    for (const path of ['/api/queue', '/api/workflows', '/api/config']) {
      const outside = await fetch(`${base}${path}?repository=${enc(secondRepository(true))}`, {
        headers: authed(web),
      });
      expect(outside.status, path).toBe(400);
    }
  });
});

describe('webTokenFromEnv', () => {
  it('returns undefined without the variable', () => {
    expect(webTokenFromEnv({})).toBeUndefined();
  });

  it('accepts 16 to 128 URL-safe characters', () => {
    expect(webTokenFromEnv({ AIP_WEB_TOKEN: 'a'.repeat(16) })).toBe('a'.repeat(16));
    expect(webTokenFromEnv({ AIP_WEB_TOKEN: 'Z_-9'.repeat(32) })).toHaveLength(128);
  });

  it.each(['a'.repeat(15), 'a'.repeat(129), `${'a'.repeat(16)}/`])('rejects %s', (value) => {
    expect(() => webTokenFromEnv({ AIP_WEB_TOKEN: value })).toThrow('AIP_WEB_TOKEN');
  });
});

describe('aip web repositories', () => {
  function temporaryRepository(): string {
    const repo = join(realpathSync(mkdtempSync(join(tmpdir(), 'aip-web-repo-'))), 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    return repo;
  }

  it('rejects a relative path without calling the daemon and a request without a token', async () => {
    const { h, web, base } = await setup();
    const relative = await fetch(`${base}/api/repositories`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ path: 'relative/dir' }),
    });
    expect(relative.status).toBe(400);
    expect(await h.call('repositories', {})).toEqual([]);
    const anonymous = await fetch(`${base}/api/repositories`, {
      method: 'POST',
      headers: JSON_TYPE,
      body: JSON.stringify({ path: h.repo }),
    });
    expect(anonymous.status).toBe(401);
    const noPath = await fetch(`${base}/api/repositories?repository=rel`, {
      method: 'DELETE',
      headers: authed(web),
    });
    expect(noPath.status).toBe(400);
  });

  it('adds a repository, lists it and refuses to remove one with an unfinished run', async () => {
    const { h, web, base } = await setup();
    const repo = temporaryRepository();
    const added = await fetch(`${base}/api/repositories`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ path: repo }),
    });
    expect(added.status).toBe(200);
    expect(((await added.json()) as { path: string }[]).map((entry) => entry.path)).toEqual([repo]);
    const listed = await fetch(`${base}/api/repositories`, { headers: authed(web) });
    expect(((await listed.json()) as { path: string }[]).map((entry) => entry.path)).toEqual([
      repo,
    ]);
    const outside = await fetch(`${base}/api/repositories`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ path: tmpdir() }),
    });
    expect(outside.status).toBe(400);

    h.script({ code: [{ verdict: 'needs_human', feedback: 'вопрос?' }, {}] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'needs_human');
    const refused = await fetch(
      `${base}/api/repositories?repository=${encodeURIComponent(h.repo)}`,
      { method: 'DELETE', headers: authed(web) },
    );
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('unfinished runs');
    const removed = await fetch(`${base}/api/repositories?repository=${encodeURIComponent(repo)}`, {
      method: 'DELETE',
      headers: authed(web),
    });
    expect(removed.status).toBe(200);
  });

  it('relays the repositories event and the list in the snapshot', async () => {
    const { h, web, base } = await setup();
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, {
      headers: authed(web),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const read = async (until: string) => {
      const deadline = Date.now() + 10_000;
      while (!text.includes(until) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await read('"snapshot"');
    expect(text).toContain('"repositories":[]');
    const repo = temporaryRepository();
    await h.call('repository_add', { path: repo });
    await read('"event":"repositories"');
    expect(text).toContain('"event":"repositories"');
    expect(text).toContain(repo);
    controller.abort();
  });
});

describe('aip web general settings', () => {
  const putSetting = (web: WebServer, base: string, path: string, body: unknown) =>
    fetch(`${base}/api/config/settings/${path}`, {
      method: 'PUT',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify(body),
    });

  it('writes delivery.auto to the global file, answers 409 for a stale revision and 404 for others', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    const file = join(h.environment.XDG_CONFIG_HOME ?? '', 'aip', 'settings.yaml');

    const done = await putSetting(web, base, 'delivery.auto', { value: true, revision: null });
    expect(done.status).toBe(200);
    expect(readFileSync(file, 'utf8')).toBe('delivery:\n  auto: true\n');

    const stale = await putSetting(web, base, 'delivery.auto', { value: false, revision: null });
    expect(stale.status).toBe(409);
    expect(readFileSync(file, 'utf8')).toBe('delivery:\n  auto: true\n');

    const view = (await (await fetch(`${base}/api/config`, { headers: authed(web) })).json()) as {
      settingsFiles: { global: { file: string; revision: string | null } };
    };
    expect(view.settingsFiles.global.file).toBe(file);
    expect(view.settingsFiles.global.revision).not.toBeNull();

    expect((await putSetting(web, base, 'max', { value: true, revision: null })).status).toBe(404);
    expect(
      (await putSetting(web, base, 'delivery.auto', { value: 'yes', revision: null })).status,
    ).toBe(400);
    const anonymous = await fetch(`${base}/api/config/settings/delivery.auto`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify({ value: true, revision: null }),
    });
    expect(anonymous.status).toBe(401);
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function newRepository(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'aip-web-repo-')));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  execFileSync(
    'git',
    [
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@e.com',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'init',
    ],
    {
      cwd: repo,
    },
  );
  return repo;
}

describe('aip web without a token', () => {
  it('serves the page and the API without a token and sets no cookie', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({ socket: h.socket, port: 0, auth: 'none', repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    expect(web.token).toBeNull();
    expect(web.url).toBe(`${base}/`);
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('set-cookie')).toBeNull();
    expect((await fetch(`${base}/api/runs`)).status).toBe(200);
  });

  it('still refuses a foreign Origin or Host', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({ socket: h.socket, port: 0, auth: 'none', repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    const post = await fetch(`${base}/api/runs/none/cancel`, {
      method: 'POST',
      headers: { ...JSON_TYPE, origin: 'http://evil.example' },
      body: '{}',
    });
    expect(post.status).toBe(403);
    const foreignHost = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: web!.port,
          path: '/api/runs',
          headers: { host: 'evil.example' },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on('error', reject);
      request.end();
    });
    expect(foreignHost).toBe(403);
  });
});

describe('default repository of the panel', () => {
  it('uses the repository added last, and answers 409 while there is none', async () => {
    h = await harness(MANUAL_CONFIG);
    let registered: string[] = [];
    web = await startWebServer({
      socket: h.socket,
      port: 0,
      defaultRepository: async () => registered.at(-1) ?? null,
    });
    const base = `http://127.0.0.1:${web.port}`;
    const headers = authed(web);
    const empty = await fetch(`${base}/api/queue`, { headers });
    expect(empty.status).toBe(409);
    expect(((await empty.json()) as { error: string }).error).toContain('add one in the panel');
    // runs do not belong to a repository
    expect((await fetch(`${base}/api/runs`, { headers })).status).toBe(200);

    const first = newRepository();
    const second = newRepository();
    await h.call('repository_add', { path: first });
    await h.call('repository_add', { path: second });
    registered = [first, second];
    const queue = (await (await fetch(`${base}/api/queue`, { headers })).json()) as QueueView;
    expect(queue.repository).toBe(second);
  });

  it('never falls back to the process directory without a default repository', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({ socket: h.socket, port: 0 });
    const base = `http://127.0.0.1:${web.port}`;
    const headers = authed(web);
    for (const path of ['/api/queue', '/api/config', '/api/workflows']) {
      const response = await fetch(`${base}${path}`, { headers });
      expect(response.status, path).toBe(409);
    }
  });
});

describe('startDaemonPanel', () => {
  async function panelSetup(settings: string, extra: NodeJS.ProcessEnv = {}) {
    h = await harness(MANUAL_CONFIG);
    const config = mkdtempSync(join(tmpdir(), 'aip-panel-config-'));
    mkdirSync(join(config, 'aip'));
    writeFileSync(join(config, 'aip', 'settings.yaml'), settings);
    const lines: string[] = [];
    const options = {
      stateDirectory: h.state,
      socket: h.socket,
      environment: { XDG_CONFIG_HOME: config, ...extra },
      log: (line: string) => void lines.push(line),
    };
    return { options, lines };
  }

  it('starts the panel on the configured port, writes the state file and picks the last repository', async () => {
    const port = await freePort();
    const { options } = await panelSetup(`web: { port: ${port} }\n`);
    const panel = await startDaemonPanel(options);
    expect(panel).not.toBeNull();
    try {
      const state = readPanelState(options.stateDirectory);
      expect(state).toMatchObject({ pid: process.pid, port, auth: 'token' });
      expect(state?.url).toBe(panel?.url);
      const token = state?.token ?? '';
      const queue = await fetch(`http://127.0.0.1:${port}/api/queue`, {
        headers: { 'x-aip-token': token },
      });
      // the registry of a fresh daemon is empty: nothing to show yet
      expect(queue.status).toBe(409);
      const first = newRepository();
      const second = newRepository();
      await h?.call('repository_add', { path: first });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await h?.call('repository_add', { path: second });
      const view = await fetch(`http://127.0.0.1:${port}/api/queue`, {
        headers: { 'x-aip-token': token },
      });
      expect(((await view.json()) as QueueView).repository).toBe(second);
    } finally {
      await panel?.close();
    }
    expect(readPanelState(options.stateDirectory)).toBeNull();
  });

  it('keeps the token across restarts, unless AIP_WEB_TOKEN says otherwise', async () => {
    const port = await freePort();
    const { options } = await panelSetup(`web: { port: ${port} }\n`);
    const first = await startDaemonPanel(options);
    const token = new URL(first?.url ?? '').searchParams.get('token');
    await first?.close();
    expect(token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    // the file of the stopped panel is gone, the token is lost with it: write it back as a crash
    writePanelState(options.stateDirectory, {
      pid: 2 ** 22 + 777,
      host: '127.0.0.1',
      port,
      auth: 'token',
      token,
      url: 'http://127.0.0.1/',
    });
    const second = await startDaemonPanel(options);
    try {
      expect(new URL(second?.url ?? '').searchParams.get('token')).toBe(token);
    } finally {
      await second?.close();
    }
    const fixed = await startDaemonPanel({
      ...options,
      environment: { ...options.environment, AIP_WEB_TOKEN: 'abcdefghijklmnop1234' },
    });
    try {
      expect(fixed?.url).toContain('token=abcdefghijklmnop1234');
    } finally {
      await fixed?.close();
    }
  });

  it('starts without a token when web.auth is none', async () => {
    const port = await freePort();
    const { options } = await panelSetup(`web: { port: ${port}, auth: none }\n`);
    const panel = await startDaemonPanel(options);
    try {
      expect(panel?.url).toBe(`http://127.0.0.1:${port}/`);
      expect((await fetch(`http://127.0.0.1:${port}/api/runs`)).status).toBe(200);
    } finally {
      await panel?.close();
    }
  });

  it('does not start when disabled by the settings or the environment', async () => {
    const port = await freePort();
    const off = await panelSetup(`web: { port: ${port}, autostart: false }\n`);
    expect(await startDaemonPanel(off.options)).toBeNull();
    expect(off.lines).toEqual([]);
    const env = await panelSetup(`web: { port: ${port} }\n`, { AIP_WEB_AUTOSTART: '0' });
    expect(await startDaemonPanel(env.options)).toBeNull();
    expect(readPanelState(env.options.stateDirectory)).toBeNull();
  });

  it('logs the reason and returns null when the port is taken or the section is wrong', async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const port = (taken.address() as AddressInfo).port;
    try {
      const busy = await panelSetup(`web: { port: ${port} }\n`);
      expect(await startDaemonPanel(busy.options)).toBeNull();
      expect(busy.lines.join('\n')).toContain(`web panel not started: port 127.0.0.1:${port}`);
    } finally {
      taken.close();
    }
    const wrong = await panelSetup('web: { host: 0.0.0.0 }\n');
    expect(await startDaemonPanel(wrong.options)).toBeNull();
    expect(wrong.lines.join('\n')).toContain('swarm.web.host');
    const badToken = await panelSetup(`web: { port: ${await freePort()} }\n`, {
      AIP_WEB_TOKEN: 'short',
    });
    expect(await startDaemonPanel(badToken.options)).toBeNull();
    expect(badToken.lines.join('\n')).toContain('AIP_WEB_TOKEN');
  });
});

describe('createDaemonPanel', () => {
  async function setup(settings: string, extra: NodeJS.ProcessEnv = {}) {
    h = await harness(MANUAL_CONFIG);
    const config = mkdtempSync(join(tmpdir(), 'aip-panel-config-'));
    mkdirSync(join(config, 'aip'));
    const file = join(config, 'aip', 'settings.yaml');
    writeFileSync(file, settings);
    const lines: string[] = [];
    const controller = createDaemonPanel({
      stateDirectory: h.state,
      socket: h.socket,
      environment: { XDG_CONFIG_HOME: config, ...extra },
      log: (line) => void lines.push(line),
    });
    return { controller, lines, file, state: h.state };
  }

  const up = (port: number) =>
    fetch(`http://127.0.0.1:${port}/`).then(
      () => true,
      () => false,
    );

  it('starts on demand when web.autostart is false, and a second start changes nothing', async () => {
    const port = await freePort();
    const { controller, state } = await setup(`web: { port: ${port}, autostart: false }\n`);
    try {
      expect(await controller.autostart()).toBeNull();
      expect(controller.status()).toMatchObject({ running: false, reason: null });
      const first = await controller.start({});
      expect(first.state).toBe('started');
      expect(first.status).toMatchObject({ running: true, port, auth: 'token' });
      expect(readPanelState(state)?.port).toBe(port);
      const second = await controller.start({});
      expect(second.state).toBe('already_running');
      expect(second.status.url).toBe(first.status.url);
    } finally {
      await controller.close();
    }
  });

  it('restarts on the new port with the same token and re-reads the settings', async () => {
    const port = await freePort();
    const { controller, file, state } = await setup(`web: { port: ${port} }\n`);
    try {
      const first = await controller.start({});
      const token = new URL(first.status.url ?? '').searchParams.get('token');
      const next = await freePort();
      writeFileSync(file, `web: { port: ${next} }\n`);
      const again = await controller.start({ restart: true });
      expect(again.state).toBe('restarted');
      expect(again.status.port).toBe(next);
      expect(new URL(again.status.url ?? '').searchParams.get('token')).toBe(token);
      expect(await up(port)).toBe(false);
      expect(await up(next)).toBe(true);
      expect(readPanelState(state)?.port).toBe(next);
    } finally {
      await controller.close();
    }
  });

  it('takes the token of the call over the one it had', async () => {
    const port = await freePort();
    const { controller } = await setup(`web: { port: ${port} }\n`);
    try {
      await controller.start({});
      const fixed = await controller.start({ restart: true, token: 'abcdefghijklmnop1234' });
      expect(fixed.status.url).toContain('token=abcdefghijklmnop1234');
    } finally {
      await controller.close();
    }
  });

  it('stops the panel, frees the port, removes web.json and stays stopped for autostart', async () => {
    const port = await freePort();
    const { controller, state } = await setup(`web: { port: ${port} }\n`);
    await controller.start({});
    expect(await controller.stop()).toEqual({ state: 'stopped' });
    expect(await up(port)).toBe(false);
    expect(readPanelState(state)).toBeNull();
    expect(controller.status()).toMatchObject({ running: false, stopped: true });
    expect(await controller.stop()).toEqual({ state: 'not_running' });
    expect(await controller.autostart()).toBeNull();
    expect((await controller.start({})).state).toBe('started');
    await controller.close();
  });

  it('keeps the reason when the port is taken or the section is wrong', async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const port = (taken.address() as AddressInfo).port;
    try {
      const { controller, file } = await setup(`web: { port: ${port} }\n`);
      await expect(controller.start({})).rejects.toThrow(
        `port 127.0.0.1:${port} is already in use`,
      );
      expect(controller.status()).toMatchObject({
        running: false,
        reason: `port 127.0.0.1:${port} is already in use`,
      });
      writeFileSync(file, 'web: { host: 0.0.0.0 }\n');
      await expect(controller.start({})).rejects.toThrow('swarm.web.host');
      expect(controller.status().reason).toContain('swarm.web.host');
      await controller.close();
    } finally {
      taken.close();
    }
  });

  it('raises one server for parallel starts', async () => {
    const port = await freePort();
    const { controller } = await setup(`web: { port: ${port} }\n`);
    try {
      const [a, b, c, auto] = await Promise.all([
        controller.start({}),
        controller.start({}),
        controller.start({}),
        controller.autostart(),
      ]);
      expect([a.state, b.state, c.state]).toEqual([
        'started',
        'already_running',
        'already_running',
      ]);
      expect(auto).not.toBeNull();
    } finally {
      await controller.close();
    }
  });
});
