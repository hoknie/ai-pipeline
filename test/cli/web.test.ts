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

import {
  createDaemonPanel,
  startDaemonPanel,
} from '../../src/presentation/web/panel/daemon-panel.ts';
import { settingsFrom, withSettings } from './settings.ts';
import { readPanelState, writePanelState } from '../../src/presentation/web/panel/state.ts';
import { databasePath } from '../../src/platform/paths/index.ts';
import { openStorage } from '../feature/storage.ts';
import {
  startWebServer,
  webTokenFromEnv,
  type WebServer,
} from '../../src/presentation/web/server.ts';
import type {
  GroupView,
  QueueView,
  RunCreated,
  RunView,
} from '../../src/presentation/ipc/contract/index.ts';
import { MANUAL_CONFIG, harness, startRun, until, type Harness } from '../daemon/harness.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';
import { waitValue } from '../fixtures/wait-until.ts';

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

  it('lists background processes without a repository and refuses foreign PIDs', async () => {
    const { web, base } = await setup();
    expect((await fetch(`${base}/api/processes`)).status).toBe(401);
    const list = await fetch(`${base}/api/processes`, { headers: authed(web) });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ processes: [] });
    const kill = (pid: string, headers = authed(web, JSON_TYPE)) =>
      fetch(`${base}/api/processes/${pid}/kill`, { method: 'POST', headers });
    expect((await kill('1', {})).status).toBe(401);
    expect((await kill('abc')).status).toBe(400);
    const foreign = await kill(String(process.pid));
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as { error: string }).error).toContain(
      'not a background process',
    );
  });

  it('lists runs and shows a group', async () => {
    const { h, web, base } = await setup();
    h.script({ code: [{ write: { 'openspec/changes/add-login/tasks.md': '- [ ] one\n' } }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
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
    const page = (await (
      await fetch(`${base}/api/finished-runs?limit=5`, { headers: authed(web) })
    ).json()) as { runs: RunView[]; next: string | null };
    expect(page.runs.map((run) => run.id)).toContain(runId);
    expect(page.next).toBeNull();
    for (const query of ['limit=0', 'limit=101', 'before=garbage']) {
      expect(
        (await fetch(`${base}/api/finished-runs?${query}`, { headers: authed(web) })).status,
      ).toBe(400);
    }
    expect((await fetch(`${base}/api/finished-runs`)).status).toBe(401);
    expect((await fetch(`${base}/api/runs/nope`, { headers: authed(web) })).status).toBe(404);
    // The old addresses of the pipelines are gone.
    for (const old of [
      '/api/workflows',
      '/api/shared-workflows',
      '/api/config/workflows/feature',
    ]) {
      expect((await fetch(`${base}${old}`, { headers: authed(web) })).status).toBe(404);
    }
    expect(
      (await fetch(`${base}/api/runs/${runId}/groups/nope`, { headers: authed(web) })).status,
    ).toBe(404);
    const spec = await fetch(`${base}/api/runs/${runId}/groups/login/spec`, {
      headers: authed(web),
    });
    expect(spec.status).toBe(200);
    expect(await spec.json()).toMatchObject({ change: 'add-login', tasks: '- [ ] one\n' });
    expect(
      (await fetch(`${base}/api/runs/${runId}/groups/nope/spec`, { headers: authed(web) })).status,
    ).toBe(404);
    expect((await fetch(`${base}/api/runs?tail=x`, { headers: authed(web) })).status).toBe(200);
  });

  it('serves a run by id after it left the list of the 10 recent finished runs', async () => {
    const harnessed = await harness(MANUAL_CONFIG);
    h = harnessed;
    const first = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(first.runId, (run) => run.finished);
    const ids = [first.runId];
    // Ten later finished runs are copies of the first one, written while the daemon is down.
    await h.restart(() => {
      const store = openStorage(databasePath(harnessed.state));
      const original = store.runs.loadRun(first.runId)!;
      for (let index = 1; index <= 10; index++) {
        const copy = structuredClone(original);
        copy.run.id = `${first.runId}-copy${index}`;
        copy.run.createdAt = original.run.createdAt + index;
        copy.run.number = original.run.number + index;
        store.runs.saveRun(copy);
        ids.push(copy.run.id);
      }
      store.database.close();
    });
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    const oldest = ids[0]!;
    const listed = (await (
      await fetch(`${base}/api/runs`, { headers: authed(web) })
    ).json()) as RunView[];
    expect(listed.map((run) => run.id)).not.toContain(oldest);
    const response = await fetch(`${base}/api/runs/${oldest}`, { headers: authed(web) });
    expect(response.status).toBe(200);
    expect(((await response.json()) as RunView).id).toBe(oldest);
  });

  it('routes marking a run delivered by hand with validation', async () => {
    const { h, web, base } = await setup();
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.finished);
    const post = (path: string, body: unknown) =>
      fetch(`${base}/api/runs/${runId}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });

    expect((await post('/delivered', { groups: [''] })).status).toBe(400);
    const marked = await post('/delivered', {});
    expect(marked.status).toBe(200);
    const markedResult = (await marked.json()) as {
      groups: { delivery: { state: string; manual: boolean } }[];
    };
    expect(markedResult.groups.every((group) => group.delivery.manual)).toBe(true);
    const again = await post('/delivered', {});
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toContain('nothing to mark');
    expect(
      (
        await fetch(`${base}/api/runs/nope/delivered`, {
          method: 'POST',
          headers: authed(web, JSON_TYPE),
          body: '{}',
        })
      ).status,
    ).toBe(404);
  });

  it('routes retry and apply with validation', async () => {
    const { h, web, base } = await setup();
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
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
    expect((await post('/groups/login/retry', { refreshConfig: 'yes' })).status).toBe(400);
    const refreshed = await post('/groups/login/retry', { refreshConfig: true });
    expect(refreshed.status).toBe(400);
    expect(((await refreshed.json()) as { error: string }).error).toContain(
      'retry needs failed, cancelled or conflict',
    );
    const missing = await post('/groups/nope/retry', {});
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toContain('unknown group');
  });

  it('passes refreshConfig of a retry to the daemon', async () => {
    const { h, web, base } = await setup();
    h.script({ code: [{ exitCode: 1, noReport: true }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.groups[0]?.status === 'failed');
    writeConfigDirectory(h.repo, MANUAL_CONFIG.replace('max: 3', 'max: 100'));
    const retry = await fetch(`${base}/api/runs/${runId}/groups/login/retry`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ refreshConfig: true }),
    });
    expect(retry.status).toBe(400);
    expect(((await retry.json()) as { error: string }).error).toMatch(
      /^configuration not loaded: swarm\.max/,
    );
    expect((await h.status(runId)).groups[0]?.status).toBe('failed');
  });

  it('streams a snapshot over SSE', async () => {
    const { h, web, base } = await setup();
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
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
    await h.call('queue_add', { repository: h.repo, pipeline: 'feature', task: 'x' });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await read(runId);
    controller.abort();
    expect(text).toContain(`"id":"${runId}"`);
  });

  it('relays the processes event and gives the last one to a new client', async () => {
    h = await harness(MANUAL_CONFIG, {}, { processesIntervalMs: 60_000 });
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    const open = async () => {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/events`, {
        headers: authed(web!),
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const client = { text: '', controller };
      const read = async (until: string) => {
        const deadline = Date.now() + 10_000;
        while (!client.text.includes(until) && Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          client.text += decoder.decode(value);
        }
      };
      return { client, read };
    };
    const first = await open();
    await first.read('"event":"processes"');
    expect(first.client.text).toContain('"event":"processes"');
    const second = await open();
    await second.read('"event":"processes"');
    const text = second.client.text;
    expect(text.indexOf('"event":"snapshot"')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('"event":"processes"')).toBeGreaterThan(text.indexOf('"event":"snapshot"'));
    await h.call('tag_add', { repository: h.repo, name: 'later' });
    await second.read('"name":"later"');
    first.client.controller.abort();
    second.client.controller.abort();
    expect(second.client.text).toContain('"name":"later"');
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
    await h.call('tag_add', { repository: h.repo, name: 'auth' });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
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
      pipeline: 'feature',
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

  it('changes the title of a run through the API', async () => {
    const { h, web, base } = await setup();
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    const set = await post(`/api/runs/${runId}/title`, { title: '  Новое название ' });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { title: string }).title).toBe('Новое название');
    expect((await post(`/api/runs/${runId}/title`, {})).status).toBe(400);
    expect((await post(`/api/runs/${runId}/title`, { title: '  ' })).status).toBe(400);
    expect((await post(`/api/runs/${runId}/title`, { title: 'x'.repeat(61) })).status).toBe(400);
    expect((await post('/api/runs/unknown/title', { title: 'x' })).status).toBe(404);
  });

  it('serves the catalog of the chosen repository', async () => {
    const { h, web, base } = await setup();
    const second = realpathSync(mkdtempSync(join(tmpdir(), 'aip-second-')));
    execFileSync('git', ['init', '-q', '-b', 'main', second]);
    const post = (path: string, body: unknown, repository?: string) =>
      fetch(`${base}${path}${repository ? `?repository=${encodeURIComponent(repository)}` : ''}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    const names = async (repository?: string) =>
      (
        (await (
          await fetch(
            `${base}/api/tags${repository ? `?repository=${encodeURIComponent(repository)}` : ''}`,
            { headers: authed(web) },
          )
        ).json()) as { name: string; repository: string }[]
      ).map((tag) => `${tag.name}@${tag.repository}`);
    expect((await post('/api/tags', { name: 'auth' })).status).toBe(200);
    expect((await post('/api/tags', { name: 'auth' }, second)).status).toBe(200);
    expect(await names()).toEqual([`auth@${h.repo}`]);
    expect(await names(second)).toEqual([`auth@${second}`]);
    expect((await post('/api/tags/edit', { tag: 'auth', name: 'ui' }, second)).status).toBe(200);
    expect(await names()).toEqual([`auth@${h.repo}`]);
    expect((await post('/api/tags/remove', { tag: 'ui' }, second)).status).toBe(200);
    expect(await names(second)).toEqual([]);
    expect(await names()).toEqual([`auth@${h.repo}`]);
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
      await post('/api/queue/items', { pipeline: 'feature', task: 'x', tags: ['auth', 'ui'] })
    ).json()) as QueueView & { item: string };
    expect(added.items[0]?.tags.map((t) => t.name)).toEqual(['auth', 'ui']);
    const edited = (await (
      await post(`/api/queue/items/${added.item}`, { tags: [] })
    ).json()) as QueueView;
    expect(edited.items[0]?.tags).toEqual([]);
    expect(
      (await post('/api/queue/items', { pipeline: 'feature', task: 'x', tags: ['nope'] })).status,
    ).toBe(400);
  });

  it('rejects an unknown parent of a queued task with 400', async () => {
    const { web, base } = await setup();
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    const added = await post('/api/queue/items', {
      pipeline: 'feature',
      task: 'x',
      parent: 'nope',
    });
    expect(added.status).toBe(400);
    expect(await added.text()).toContain('unknown parent `nope`');
    const item = (await (
      await post('/api/queue/items', { pipeline: 'feature', task: 'x' })
    ).json()) as QueueView & { item: string };
    const edited = await post(`/api/queue/items/${item.item}`, { parent: 77 });
    expect(edited.status).toBe(400);
    expect(await edited.text()).toContain('unknown parent `77`');
    expect((await post(`/api/queue/items/${item.item}`, { parent: null })).status).toBe(200);
  });

  it('passes a predecessor of a queued task through the queue API', async () => {
    const { web, base } = await setup();
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    const first = (await (
      await post('/api/queue/items', { pipeline: 'feature', task: 'модель' })
    ).json()) as QueueView & { item: string };
    const second = (await (
      await post('/api/queue/items', { pipeline: 'feature', task: 'api', after: [first.item] })
    ).json()) as QueueView & { item: string };
    const added = second.items.find((item) => item.id === second.item);
    expect(added?.after.map((ref) => [ref.id, ref.state])).toEqual([[first.item, 'waiting']]);
    expect(added?.readiness).toBe('waiting');
    const read = (await (
      await fetch(`${base}/api/queue`, { headers: authed(web) })
    ).json()) as QueueView;
    expect(read.items.find((item) => item.id === second.item)?.after[0]?.id).toBe(first.item);
    expect(read.items.find((item) => item.id === first.item)?.readiness).toBe('ready');
  });

  it('passes postponed through the queue API and refuses a wrong value', async () => {
    const { web, base } = await setup();
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    const created = await post('/api/queue/items', {
      pipeline: 'feature',
      task: 'y',
      postponed: true,
    });
    expect(created.status).toBe(200);
    const createdId = ((await created.json()) as { item: string }).item;
    const afterCreate = (await (
      await fetch(`${base}/api/queue`, { headers: authed(web) })
    ).json()) as QueueView;
    expect(afterCreate.items.find((item) => item.id === createdId)?.postponed).toBe(true);
    expect(
      (await post('/api/queue/items', { pipeline: 'feature', task: 'z', postponed: 'yes' })).status,
    ).toBe(400);
    const added = (await (
      await post('/api/queue/items', { pipeline: 'feature', task: 'x' })
    ).json()) as QueueView & { item: string };
    const edited = await post(`/api/queue/items/${added.item}`, { postponed: true });
    expect(edited.status).toBe(200);
    const read = (await (
      await fetch(`${base}/api/queue`, { headers: authed(web) })
    ).json()) as QueueView;
    expect(read.items.find((item) => item.id === added.item)?.postponed).toBe(true);
    expect((await post(`/api/queue/items/${added.item}`, { postponed: 'yes' })).status).toBe(400);
  });

  it('answers 400 to a dependency cycle through the queue API', async () => {
    const { web, base } = await setup();
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    const first = (await (
      await post('/api/queue/items', { pipeline: 'feature', task: 'модель' })
    ).json()) as QueueView & { item: string };
    const second = (await (
      await post('/api/queue/items', { pipeline: 'feature', task: 'api', after: [first.item] })
    ).json()) as QueueView & { item: string };
    const cycle = await post(`/api/queue/items/${first.item}`, { after: [second.item] });
    expect(cycle.status).toBe(400);
    expect(((await cycle.json()) as { error: string }).error).toMatch(/^dependency cycle: /);
    const read = (await (
      await fetch(`${base}/api/queue`, { headers: authed(web) })
    ).json()) as QueueView;
    expect(read.items.find((item) => item.id === first.item)?.after).toEqual([]);
  });

  it('returns a failed run to the queue through the API', async () => {
    const { h, web, base } = await setup();
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    h.script({ code: [{ noReport: true }, {}] });
    await post('/api/queue/items', { pipeline: 'feature', task: 'работа' });
    await post('/api/queue/start', {});
    const run = await waitValue('the queue to stop on a problem', async () => {
      const queue = (await (
        await fetch(`${base}/api/queue`, { headers: authed(web) })
      ).json()) as QueueView;
      return queue.stop?.kind === 'problem' ? queue.stop.run : null;
    });
    const before = (await (
      await fetch(`${base}/api/runs/${run}`, { headers: authed(web) })
    ).json()) as { returnable: boolean };
    expect(before.returnable).toBe(true);
    const returned = await post('/api/queue/return', { run });
    expect(returned.status).toBe(200);
    expect(((await returned.json()) as QueueView).items[0]).toMatchObject({ run });
    const after = (await (
      await fetch(`${base}/api/runs/${run}`, { headers: authed(web) })
    ).json()) as { returnable: boolean };
    expect(after.returnable).toBe(false);
    expect((await post('/api/queue/return', { run })).status).toBe(400);
  });

  it('pauses a run through the API', async () => {
    const { h, web, base } = await setup();
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    h.script({ code: [{ waitFor: h.gate('a') }] });
    const added = (await (
      await post('/api/queue/items', { pipeline: 'feature', task: 'работа' })
    ).json()) as QueueView & { item: string };
    await post(`/api/queue/items/${added.item}/run`, {});
    const run = await waitValue('a run in the queue', async () => {
      const queue = (await (
        await fetch(`${base}/api/queue`, { headers: authed(web) })
      ).json()) as QueueView;
      return queue.runs[0]?.id;
    });
    expect(run).not.toBe('');
    const paused = await post(`/api/runs/${run}/pause`, {});
    expect(paused.status).toBe(200);
    expect(((await paused.json()) as QueueView).items[0]).toMatchObject({ run, hold: 'paused' });
    const again = await post(`/api/runs/${run}/pause`, {});
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toContain('run is already paused');
    expect((await post('/api/runs/nope/pause', {})).status).toBe(404);
    h.open('a');
  });

  it('removes a skipped run through the API', async () => {
    const { h, web, base } = await setup();
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    h.script({ code: [{ noReport: true }, {}] });
    await post('/api/queue/settings', { skipFailed: true });
    await post('/api/queue/items', { pipeline: 'feature', task: 'работа' });
    await post('/api/queue/start', {});
    const run = await waitValue('a skipped run', async () => {
      const queue = (await (
        await fetch(`${base}/api/queue`, { headers: authed(web) })
      ).json()) as QueueView;
      return queue.skipped[0]?.id;
    });
    expect(run).not.toBe('');
    const dismissed = await post('/api/queue/dismiss', { run });
    expect(dismissed.status).toBe(200);
    expect(((await dismissed.json()) as QueueView).skipped).toEqual([]);
    const again = await post('/api/queue/dismiss', { run });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toContain(
      'run is not in the skipped list',
    );
    expect((await post('/api/queue/dismiss', { run: 'zzz' })).status).toBe(404);
    expect((await post('/api/queue/dismiss', {})).status).toBe(400);
  });

  it('serves the queue API with the same protection as the rest', async () => {
    const { h, web, base } = await setup();
    const post = (path: string, body: unknown, headers = authed(web, JSON_TYPE)) =>
      fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const read = async () =>
      (await (await fetch(`${base}/api/queue`, { headers: authed(web) })).json()) as QueueView;
    expect((await fetch(`${base}/api/queue`)).status).toBe(401);
    expect(
      (await post('/api/queue/items', { pipeline: 'feature', task: 'x' }, JSON_TYPE)).status,
    ).toBe(401);
    expect((await read()).items).toEqual([]);
    expect((await fetch(`${base}/api/queue/items`, { headers: authed(web) })).status).toBe(405);
    expect((await fetch(`${base}/api/queue/start`, { headers: authed(web) })).status).toBe(405);
    expect((await post('/api/queue', {})).status).toBe(405);

    const added = await post('/api/queue/items', { pipeline: 'feature', task: 'первая' });
    expect(added.status).toBe(200);
    await post('/api/queue/items', { pipeline: 'feature', task: 'вторая', title: 'Вторая' });
    const third = (await (
      await post('/api/queue/items', {
        pipeline: 'feature',
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
      ['/api/queue/items', { pipeline: 'feature', task: '  ' }],
      ['/api/queue/items', { pipeline: 'feature' }],
      ['/api/queue/items', { pipeline: 'nope', task: 'x' }],
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
    const skipFailed = await post('/api/queue/settings', { skipFailed: true });
    expect(skipFailed.status).toBe(200);
    expect(await skipFailed.json()).toMatchObject({
      skipFailed: true,
      parallel: 2,
      autopilot: false,
    });
    expect((await read()).skipFailed).toBe(true);
    const answered = (await (
      await post('/api/queue/settings', { autopilotAnswer: 'Согласен' })
    ).json()) as QueueView;
    expect(answered.autopilotAnswer).toBe('Согласен');
    const restored = (await (
      await post('/api/queue/settings', { autopilotAnswer: null })
    ).json()) as QueueView;
    expect(restored.autopilotAnswer).toBeNull();
    expect((await post('/api/queue/settings', { autopilotAnswer: ' ' })).status).toBe(400);
    const empty = await post('/api/queue/settings', {});
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toContain(
      'pass parallel, autopilot, autoAnswer, autopilotAnswer, skipFailed or onLimit',
    );
    const onLimit = await post('/api/queue/settings', { onLimit: 'stop' });
    expect(onLimit.status).toBe(200);
    expect(await onLimit.json()).toMatchObject({ onLimit: 'stop' });
    const wrongLimit = await post('/api/queue/settings', { onLimit: 'retry' });
    expect(wrongLimit.status).toBe(400);
    expect(((await wrongLimit.json()) as { error: string }).error).toBe(
      'onLimit must be one of: wait, stop',
    );
    const unknownRun = await post('/api/queue/return', { run: 'zzz' });
    expect(unknownRun.status).toBe(404);
    expect(((await unknownRun.json()) as { error: string }).error).toContain('unknown run');
    expect((await post('/api/queue/return', {})).status).toBe(400);
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
    await h.call('queue_add', { repository: h.repo, pipeline: 'feature', task: 'из терминала' });
    expect(await first.until('"event":"queue"')).toContain('из терминала');
    first.controller.abort();
    const second = await open();
    const text = await second.until('из терминала');
    second.controller.abort();
    expect(text).toContain('"event":"snapshot"');
    expect(text).toMatch(/"queues":\[\{[^]*из терминала/);
  });

  it('skips a step through POST with validation', async () => {
    const { h, web, base } = await setup();
    // the agent stays running until the daemon of the test is stopped
    h.script({ code: [{ waitFor: h.gate('hold') }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.groups.some((group) => group.status === 'running'));
    const post = (body: unknown) =>
      fetch(`${base}/api/runs/${runId}/skip`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    expect((await post({ step: 'review' })).status).toBe(400);
    const ok = await post({ step: 'review', skip: true });
    expect(ok.status).toBe(200);
    const view = (await ok.json()) as RunView;
    expect(view.steps.find((entry) => entry.id === 'review')?.skipped).toBe(true);
    const refused = await post({ step: 'nope', skip: true });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain('unknown step');
  });

  it('sends a message to the running specialist through POST', async () => {
    const { h, web, base } = await setup();
    h.script({ code: [{ waitFor: h.gate('code') }, { waitFor: h.gate('hold') }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.groups.some((group) => group.status === 'running'));
    const url = `${base}/api/runs/${runId}/groups/login/message`;
    const post = (body: unknown) =>
      fetch(url, { method: 'POST', headers: authed(web, JSON_TYPE), body: JSON.stringify(body) });
    expect((await post({ seq: 1, text: '  ' })).status).toBe(400);
    expect((await post({ seq: 0, text: 'x' })).status).toBe(400);
    expect((await post({ text: 'x' })).status).toBe(400);
    expect((await post({ seq: 7, text: 'x' })).status).toBe(400);
    expect((await post({ seq: 1, text: 'use OAuth' })).status).toBe(200);
    await until('the next attempt carries the message', async () => {
      const view = await h.group(runId, 'login');
      return view.attempts.at(-1)?.message?.text === 'use OAuth';
    });
    h.open('hold');
  });

  it('answers a question and cancels through POST', async () => {
    const { h, web, base } = await setup();
    h.script({
      code: [{ verdict: 'needs_human', feedback: 'Which auth?' }, { waitFor: h.gate('hold') }],
    });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
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

  it('refuses to pause an unknown run', async () => {
    const { web, base } = await setup();
    const response = await fetch(`${base}/api/runs/missing/pause`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: '{}',
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(((await response.json()) as { error: string }).error).toContain('unknown run');
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
      pipeline: 'feature',
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

  it('serves the diff of a file and the patch of the run as an attachment', async () => {
    const { h, web, base } = await setup();
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.finished);
    const diffUrl = `${base}/api/runs/${runId}/groups/login/diff`;
    const diff = await fetch(`${diffUrl}?path=lib.ts`, { headers: authed(web) });
    expect(diff.status).toBe(200);
    expect(((await diff.json()) as { lines: string[] }).lines).toContain(
      '+export const value = 2;',
    );
    expect((await fetch(diffUrl, { headers: authed(web) })).status).toBe(400);
    expect((await fetch(`${diffUrl}?path=none.ts`, { headers: authed(web) })).status).toBe(404);
    expect((await fetch(`${diffUrl}?path=lib.ts`)).status).toBe(401);

    const patchUrl = `${base}/api/runs/${runId}/patch`;
    const patch = await fetch(patchUrl, { headers: authed(web) });
    expect(patch.status).toBe(200);
    expect(patch.headers.get('content-type')).toBe('text/x-diff; charset=binary');
    expect(patch.headers.get('content-disposition')).toBe(`attachment; filename="${runId}.patch"`);
    const bytes = Buffer.from(await patch.arrayBuffer());
    expect(bytes.toString('utf8')).toContain('+export const value = 2;');
    const file = join(h.state, 'download.patch');
    writeFileSync(file, bytes);
    execFileSync('git', ['apply', '--check', file], { cwd: h.repo });
    expect((await fetch(patchUrl)).status).toBe(401);
    expect((await fetch(`${base}/api/runs/nope/patch`, { headers: authed(web) })).status).toBe(404);
  });

  it('lists artifacts and serves them as attachments, inline only as text', async () => {
    const { h, web, base } = await setup();
    const tool = (args: Record<string, unknown>) => ({ name: 'swarm_artifact', arguments: args });
    h.script({
      code: [
        {
          toolCalls: [
            tool({ file_name: 'Отчёт.md', content: '# Привет\n' }),
            tool({ file_name: 'page.html', content: '<script>alert(1)</script>' }),
            tool({ file_name: 'out.log', content: 'line' }),
          ],
        },
      ],
    });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.finished);
    const group = (await h.status(runId)).groups[0]!.slug;
    const listUrl = `${base}/api/runs/${runId}/groups/${group}/artifacts`;
    const listed = await fetch(listUrl, { headers: authed(web) });
    expect(listed.status).toBe(200);
    const { artifacts } = (await listed.json()) as {
      artifacts: { id: string; fileName: string; preview: string | null }[];
    };
    expect(artifacts.map((artifact) => artifact.fileName).sort()).toEqual([
      'out.log',
      'page.html',
      'Отчёт.md',
    ]);
    expect((await fetch(listUrl)).status).toBe(401);
    expect((await fetch(listUrl, { method: 'POST', headers: authed(web) })).status).toBe(405);
    expect(
      (await fetch(`${base}/api/runs/nope/groups/${group}/artifacts`, { headers: authed(web) }))
        .status,
    ).toBe(404);
    expect(
      (await fetch(`${base}/api/runs/${runId}/groups/nope/artifacts`, { headers: authed(web) }))
        .status,
    ).toBe(404);

    const byName = (name: string) => artifacts.find((artifact) => artifact.fileName === name)!;
    const url = (name: string) => `${listUrl}/${byName(name).id}`;
    const md = await fetch(url('Отчёт.md'), { headers: authed(web) });
    expect(md.status).toBe(200);
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(md.headers.get('x-content-type-options')).toBe('nosniff');
    expect(md.headers.get('cache-control')).toBe('no-store');
    expect(md.headers.get('content-disposition')).toBe(
      `attachment; filename="_____.md"; filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82.md`,
    );
    expect(await md.text()).toBe('# Привет\n');

    const html = await fetch(url('page.html'), { headers: authed(web) });
    expect(html.headers.get('content-type')).toBe('application/octet-stream');
    expect(html.headers.get('content-disposition')).toContain('attachment;');
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await fetch(`${url('page.html')}?inline=1`, { headers: authed(web) })).status).toBe(
      400,
    );

    const inline = await fetch(`${url('out.log')}?inline=1`, { headers: authed(web) });
    expect(inline.status).toBe(200);
    expect(inline.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(inline.headers.get('content-disposition')).toBeNull();
    expect(await inline.text()).toBe('line');

    expect((await fetch(url('out.log'))).status).toBe(401);
    expect((await fetch(url('out.log'), { method: 'DELETE', headers: authed(web) })).status).toBe(
      405,
    );
    expect((await fetch(`${listUrl}/nope`, { headers: authed(web) })).status).toBe(404);
    h.running.application.database.prepare("UPDATE artifacts SET uri = 's3://b/x'").run();
    expect((await fetch(url('out.log'), { headers: authed(web) })).status).toBe(409);
  });

  it('serves the pipelines of the repository, and the errors of a broken configuration', async () => {
    const { h, web, base } = await setup();
    const ok = await fetch(`${base}/api/pipelines?repository=${encodeURIComponent(h.repo)}`, {
      headers: authed(web),
    });
    expect(ok.status).toBe(200);
    const view = (await ok.json()) as {
      pipelines: { id: string; steps: { id: string }[] }[];
      errors: unknown[];
    };
    expect(view.errors).toEqual([]);
    expect(view.pipelines.map((pipeline) => pipeline.id)).toEqual(['feature']);
    expect(view.pipelines[0]?.steps.map((entry) => entry.id)).toEqual(['code', 'review']);
    writeConfigDirectory(h.repo, 'swarm:\n  max: 0\n');
    const broken = (await (
      await fetch(`${base}/api/pipelines?repository=${encodeURIComponent(h.repo)}`, {
        headers: authed(web),
      })
    ).json()) as { pipelines: unknown[]; errors: { path: string }[] };
    expect(broken.pipelines).toEqual([]);
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

describe('aip web specialist tags', () => {
  async function editor(): Promise<{ h: Harness; web: WebServer; base: string; lib: string }> {
    h = await harness(MANUAL_CONFIG, { HOME: mkdtempSync(join(tmpdir(), 'aip-web-home-')) });
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const lib = realpathSync(mkdtempSync(join(tmpdir(), 'aip-web-lib-')));
    execFileSync('git', ['init', '-q', '-b', 'main', lib]);
    mkdirSync(join(lib, 'aip', 'specialists'), { recursive: true });
    writeFileSync(join(lib, 'aip', 'specialists', 'plan.yaml'), 'name: Plan\ntags: [fast]\n');
    const base = `http://127.0.0.1:${web.port}`;
    await fetch(`${base}/api/config?repository=${encodeURIComponent(lib)}`, {
      headers: authed(web),
    });
    await fetch(`${base}/api/config`, { headers: authed(web) });
    return { h, web, base, lib };
  }

  const post = (web: WebServer, url: string, body: unknown) =>
    fetch(url, { method: 'POST', headers: authed(web, JSON_TYPE), body: JSON.stringify(body) });

  it('needs the token', async () => {
    const { base } = await editor();
    expect((await fetch(`${base}/api/specialist-tags`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/specialist-tags/rename`, {
          method: 'POST',
          headers: JSON_TYPE,
          body: JSON.stringify({ repository: null, from: 'a', to: 'b' }),
        })
      ).status,
    ).toBe(401);
  });

  it('lists folders and edits tags of the shared level and of a project', async () => {
    const { web, base, lib } = await editor();
    const read = async () =>
      (await (await fetch(`${base}/api/specialist-tags`, { headers: authed(web) })).json()) as {
        folders: { repository: string | null; specialists: { slug: string; tags: string[] }[] }[];
      };
    const first = await read();
    expect(first.folders[0]?.repository).toBeNull();
    const planFolder = first.folders.find((folder) => folder.repository === lib);
    expect(planFolder?.specialists).toEqual([
      expect.objectContaining({ slug: 'plan', tags: ['fast'] }),
    ]);
    const renamed = await post(web, `${base}/api/specialist-tags/rename`, {
      repository: lib,
      from: 'fast',
      to: 'quick',
    });
    expect(renamed.status).toBe(200);
    expect(readFileSync(join(lib, 'aip', 'specialists', 'plan.yaml'), 'utf8')).toContain('quick');
    const unknown = await post(web, `${base}/api/specialist-tags/remove`, {
      repository: lib,
      tag: 'nope',
    });
    expect(unknown.status).toBe(422);
    const stale = await fetch(`${base}/api/specialist-tags/specialists/plan`, {
      method: 'PUT',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ repository: lib, tags: ['x'], revision: 'stale' }),
    });
    expect(stale.status).toBe(409);
  });

  it('refuses a relative repository before it asks the daemon', async () => {
    const { web, base } = await editor();
    const response = await post(web, `${base}/api/specialist-tags/remove`, {
      repository: 'relative/path',
      tag: 'a',
    });
    expect(response.status).toBe(400);
  });

  it('imports with a conflict as 409 and a relative source as 400', async () => {
    const { h, web, base, lib } = await editor();
    const url = `${base}/api/config/specialists/import`;
    const bad = await post(web, url, { source: 'lib', slugs: ['plan'] });
    expect(bad.status).toBe(400);
    expect((await post(web, url, { source: lib, slugs: [] })).status).toBe(400);
    const done = await post(web, url, { source: lib, slugs: ['plan'] });
    expect(done.status).toBe(200);
    expect(existsSync(join(h.repo, 'aip', 'specialists', 'plan.yaml'))).toBe(true);
    const again = await post(web, url, { source: lib, slugs: ['plan'] });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { slugs: string[] }).slugs).toEqual(['plan']);
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

  it('writes and deletes an action, and lists the system stages', async () => {
    const { h, web, base } = await editor();
    const url = `${base}/api/config/actions/lint`;
    const file = join(h.repo, 'aip', 'actions', 'lint.yaml');
    const write = (body: unknown) =>
      fetch(url, { method: 'PUT', headers: authed(web, JSON_TYPE), body: JSON.stringify(body) });
    const bad = await write({ value: { run: 'true', specialist: 'coder' }, revision: null });
    expect(bad.status).toBe(422);
    expect(existsSync(file)).toBe(false);
    const created = await write({ value: { run: 'npm run lint' }, revision: null });
    expect(created.status).toBe(200);
    const { revision } = (await created.json()) as { revision: string };
    expect(readFileSync(file, 'utf8')).toContain('npm run lint');
    expect((await write({ value: { run: 'x' }, revision: 'stale' })).status).toBe(409);
    const anonymous = await fetch(url, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify({ value: { run: 'x' }, revision }),
    });
    expect(anonymous.status).toBe(401);
    const remove = (query: string) =>
      fetch(`${url}${query}`, { method: 'DELETE', headers: authed(web) });
    expect((await remove('')).status).toBe(400);
    expect((await remove(`?revision=${revision}`)).status).toBe(200);
    expect(existsSync(file)).toBe(false);

    const stages = await fetch(
      `${base}/api/system-stages?repository=${encodeURIComponent(h.repo)}`,
      {
        headers: authed(web),
      },
    );
    expect(stages.status).toBe(200);
    const view = (await stages.json()) as { stages: { kind: string }[]; errors: unknown[] };
    expect(view.errors).toEqual([]);
    expect(view.stages.map((stage) => stage.kind)).toContain('delivery');
    expect((await fetch(`${base}/api/system-stages`)).status).toBe(401);
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
      { pipeline: 'feature', step: 'review' },
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

  it('previews, writes and deletes pipelines', async () => {
    const { h, web, base } = await editor();
    const steps = [
      { id: 'code', specialist: 'coder' },
      { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 2 } },
    ];
    const file = join(h.repo, 'aip', 'pipelines', 'feature.yaml');
    const before = readFileSync(file, 'utf8');
    const post = (value: unknown, headers: Record<string, string> = authed(web, JSON_TYPE)) =>
      fetch(`${base}/api/config/pipelines/feature/preview`, {
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
    expect(bad.errors[0]?.path).toBe('swarm.pipelines.feature.steps[0].specialist');
    expect(readFileSync(file, 'utf8')).toBe(before);

    const view = (await (await fetch(`${base}/api/config`, { headers: authed(web) })).json()) as {
      pipelines: { id: string; revision: string }[];
    };
    const feature = view.pipelines.find((pipeline) => pipeline.id === 'feature')!;
    const put = (revision: string | null, value: unknown) =>
      fetch(`${base}/api/config/pipelines/feature`, {
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
      pipelines: { id: string; revision: string }[];
    };
    const removed = await fetch(
      `${base}/api/config/pipelines/feature?revision=${fresh.pipelines[0]!.revision}`,
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
      body: JSON.stringify({ pipeline: 'feature', task: 'x', repository: h.repo }),
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
    const relative = await fetch(`${base}/api/config?repository=work/lib`, {
      headers: authed(web),
    });
    expect(relative.status).toBe(400);
    expect(((await relative.json()) as { error: string }).error).toBe(
      'repository must be an absolute path or a project slug',
    );
    const unknown = await fetch(`${base}/api/queue?repository=nope`, { headers: authed(web) });
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toContain('unknown project `nope`');
    for (const path of ['/api/queue', '/api/pipelines', '/api/config']) {
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
      pipeline: 'feature',
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

  it('changes and moves a project, addressed by its slug', async () => {
    const { web, base } = await setup();
    const repo = temporaryRepository();
    await fetch(`${base}/api/repositories`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ path: repo, slug: 'fresh' }),
    });
    const queue = await fetch(`${base}/api/queue?repository=fresh`, { headers: authed(web) });
    expect(queue.status).toBe(200);
    expect(((await queue.json()) as { repository: string }).repository).toBe(repo);
    const changed = await fetch(`${base}/api/repositories?repository=fresh`, {
      method: 'PATCH',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ name: 'New', enabled: false }),
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject([{ path: repo, name: 'New', enabled: false }]);
    const unknownField = await fetch(`${base}/api/repositories?repository=fresh`, {
      method: 'PATCH',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ path: '/elsewhere' }),
    });
    expect(unknownField.status).toBe(400);
    const relative = await fetch(`${base}/api/repositories/move?repository=fresh`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ to: 'projects/new' }),
    });
    expect(relative.status).toBe(400);
    const target = temporaryRepository();
    const moved = await fetch(`${base}/api/repositories/move?repository=fresh`, {
      method: 'POST',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify({ to: target }),
    });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject([{ path: target, slug: 'fresh', name: 'New' }]);
    const anonymous = await fetch(`${base}/api/repositories?repository=fresh`, {
      method: 'PATCH',
      headers: JSON_TYPE,
      body: JSON.stringify({ name: 'X' }),
    });
    expect(anonymous.status).toBe(401);
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

const putSettingTo = (web: WebServer, base: string, path: string, body: unknown) =>
  fetch(`${base}/api/config/settings/${path}`, {
    method: 'PUT',
    headers: authed(web, JSON_TYPE),
    body: JSON.stringify(body),
  });

describe('aip web general settings', () => {
  it('writes delivery.mode and refuses a value of the wrong kind with 422', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    const file = join(h.environment.XDG_CONFIG_HOME ?? '', 'aip', 'settings.yaml');
    for (const value of [true, 'tar']) {
      const wrong = await putSettingTo(web, base, 'delivery.mode', { value, revision: null });
      expect(wrong.status).toBe(422);
    }
    const mistyped = await putSettingTo(web, base, 'delivery.auto', {
      value: 'commit',
      revision: null,
    });
    expect(mistyped.status).toBe(422);
    const done = await putSettingTo(web, base, 'delivery.mode', {
      value: 'commit',
      revision: null,
    });
    expect(done.status).toBe(200);
    expect(readFileSync(file, 'utf8')).toBe('delivery:\n  mode: commit\n');
    const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(queue.deliveryMode).toBe('commit');
  });

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

    expect(
      (await putSetting(web, base, 'specialists.coder.model', { value: 'x', revision: null }))
        .status,
    ).toBe(404);
    expect(
      (await putSetting(web, base, 'delivery.auto', { value: 'yes', revision: null })).status,
    ).toBe(422);
    expect(
      (await putSetting(web, base, 'delivery.auto', { value: { a: 1 }, revision: null })).status,
    ).toBe(400);
    const anonymous = await fetch(`${base}/api/config/settings/delivery.auto`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify({ value: true, revision: null }),
    });
    expect(anonymous.status).toBe(401);
  });
});

describe('aip web batch settings', () => {
  const putSettings = (web: WebServer, base: string, body: unknown) =>
    fetch(`${base}/api/config/settings`, {
      method: 'PUT',
      headers: authed(web, JSON_TYPE),
      body: JSON.stringify(body),
    });

  it('writes several fields at once, refuses a wrong kind and an unknown path', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    const file = join(h.environment.XDG_CONFIG_HOME ?? '', 'aip', 'settings.yaml');

    const done = await putSettings(web, base, {
      values: { max: 4, 'delivery.auto': true, 'workspace.include': ['.env'] },
      revision: null,
    });
    expect(done.status).toBe(200);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('max: 4');
    expect(text).toContain('auto: true');
    expect(text).toContain('.env');

    const wrong = await putSettings(web, base, { values: { max: 'many' }, revision: 'x' });
    expect(wrong.status).toBe(422);
    const foreign = await putSettings(web, base, {
      values: { 'specialists.coder.model': 'x' },
      revision: null,
    });
    expect(foreign.status).toBe(404);
    const empty = await putSettings(web, base, { values: {}, revision: null });
    expect(empty.status).toBe(400);
    expect(readFileSync(file, 'utf8')).toBe(text);
  });

  it('writes a variable of a runtime and never returns its value', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    const done = await putSettings(web, base, {
      values: { 'runtimes.claude.env.API_KEY': 'topsecret' },
      revision: null,
    });
    expect(done.status).toBe(200);
    expect(await done.text()).not.toContain('topsecret');
    const view = await fetch(`${base}/api/config`, { headers: authed(web) });
    const body = await view.text();
    expect(body).not.toContain('topsecret');
    expect(body).toContain('API_KEY');
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
    expect(((await empty.json()) as { error: string }).error).toContain(
      'add or enable one in the panel',
    );
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
    for (const path of ['/api/queue', '/api/config', '/api/pipelines']) {
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
    const environment = { XDG_CONFIG_HOME: config, ...extra };
    const options = {
      stateDirectory: h.state,
      socket: h.socket,
      environment,
      readSettings: settingsFrom(environment),
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
    const fixed = await startDaemonPanel(
      withSettings({
        ...options,
        environment: { ...options.environment, AIP_WEB_TOKEN: 'abcdefghijklmnop1234' },
      }),
    );
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
    const controller = createDaemonPanel(
      withSettings({
        stateDirectory: h.state,
        socket: h.socket,
        environment: { XDG_CONFIG_HOME: config, ...extra },
        log: (line) => void lines.push(line),
      }),
    );
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

describe('aip web shared specialists', () => {
  it('needs the token, lists the usage and refuses to delete a used shared specialist', async () => {
    h = await harness(MANUAL_CONFIG, { HOME: mkdtempSync(join(tmpdir(), 'aip-web-home-')) });
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    const shared = join(h.environment.XDG_CONFIG_HOME ?? '', 'aip', 'specialists');
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, 'qa.yaml'), 'name: QA\n');
    writeFileSync(join(shared, 'writer.yaml'), 'name: Writer\n');
    const lib = realpathSync(mkdtempSync(join(tmpdir(), 'aip-web-lib-')));
    execFileSync('git', ['init', '-q', '-b', 'main', lib]);
    mkdirSync(join(lib, 'aip', 'pipelines'), { recursive: true });
    writeFileSync(
      join(lib, 'aip', 'pipelines', 'feature.yaml'),
      'steps:\n  - id: test\n    specialist: qa\n',
    );
    await fetch(`${base}/api/config?repository=${encodeURIComponent(lib)}`, {
      headers: authed(web),
    });
    await fetch(`${base}/api/config`, { headers: authed(web) });

    expect((await fetch(`${base}/api/shared-specialists`)).status).toBe(401);
    const response = await fetch(`${base}/api/shared-specialists`, { headers: authed(web) });
    expect(response.status).toBe(200);
    const usage = (await response.json()) as {
      specialists: { slug: string; projects: { repository: string }[] }[];
    };
    expect(usage.specialists.find((entry) => entry.slug === 'qa')?.projects).toEqual([
      expect.objectContaining({ repository: lib }),
    ]);
    expect(usage.specialists.find((entry) => entry.slug === 'writer')?.projects).toEqual([]);

    const revision = (await (
      await fetch(`${base}/api/config`, { headers: authed(web) })
    ).json()) as {
      specialists: { slug: string; sources: { global?: { revision: string } } }[];
    };
    const qa = revision.specialists.find((entry) => entry.slug === 'qa')?.sources.global?.revision;
    const refused = await fetch(
      `${base}/api/config/specialists/qa?revision=${encodeURIComponent(qa ?? '')}&level=global`,
      { method: 'DELETE', headers: authed(web) },
    );
    expect(refused.status).toBe(422);
    const body = (await refused.json()) as { references: { repository?: string }[] };
    expect(body.references).toEqual([expect.objectContaining({ repository: lib })]);
  });
});

describe('aip web shared pipelines and import', () => {
  const post = (web: WebServer, url: string, body: unknown) =>
    fetch(url, { method: 'POST', headers: authed(web, JSON_TYPE), body: JSON.stringify(body) });

  it('needs the token and gives usage', async () => {
    h = await harness(MANUAL_CONFIG, { HOME: mkdtempSync(join(tmpdir(), 'aip-web-home-')) });
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    const shared = join(h.environment.XDG_CONFIG_HOME ?? '', 'aip');
    mkdirSync(join(shared, 'specialists'), { recursive: true });
    mkdirSync(join(shared, 'pipelines'), { recursive: true });
    writeFileSync(join(shared, 'specialists', 'coder.yaml'), 'name: Coder\n');
    writeFileSync(
      join(shared, 'pipelines', 'explore.yaml'),
      'steps:\n  - id: code\n    specialist: coder\n',
    );
    const lib = realpathSync(mkdtempSync(join(tmpdir(), 'aip-web-lib-')));
    execFileSync('git', ['init', '-q', '-b', 'main', lib]);
    mkdirSync(join(lib, 'aip', 'pipelines'), { recursive: true });
    writeFileSync(
      join(lib, 'aip', 'pipelines', 'epic.yaml'),
      'split:\n  specialist: coder\n  pipeline: explore\n',
    );
    writeFileSync(
      join(lib, 'aip', 'pipelines', 'quick.yaml'),
      'tags: [fast]\nsteps:\n  - id: code\n    specialist: coder\n',
    );
    await fetch(`${base}/api/config?repository=${encodeURIComponent(lib)}`, {
      headers: authed(web),
    });
    await fetch(`${base}/api/config`, { headers: authed(web) });

    expect((await fetch(`${base}/api/shared-pipelines`)).status).toBe(401);
    const usage = (await (
      await fetch(`${base}/api/shared-pipelines`, { headers: authed(web) })
    ).json()) as { pipelines: { id: string; projects: { repository: string }[] }[] };
    expect(usage.pipelines.find((entry) => entry.id === 'explore')?.projects).toEqual([
      expect.objectContaining({ repository: lib }),
    ]);

    const url = `${base}/api/config/pipelines/import`;
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: JSON_TYPE,
          body: JSON.stringify({ source: lib, ids: ['quick'] }),
        })
      ).status,
    ).toBe(401);
    expect((await post(web, url, { source: 'lib', ids: ['quick'] })).status).toBe(400);
    const done = await post(web, url, { source: lib, ids: ['quick'] });
    expect(done.status).toBe(200);
    expect(existsSync(join(h.repo, 'aip', 'pipelines', 'quick.yaml'))).toBe(true);
    const again = await post(web, url, { source: lib, ids: ['quick'] });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { ids: string[] }).ids).toEqual(['quick']);
  });
});

describe('API наблюдателей', () => {
  it('reads, saves and rejects the settings without a repository', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({
      socket: h.socket,
      port: 0,
      auth: 'none',
      defaultRepository: async () => null,
    });
    const base = `http://127.0.0.1:${web.port}`;
    const read = await fetch(`${base}/api/observers`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      settings: { enabled: false, workers: 1, maxRepairs: 5 },
      workers: { running: [], waiting: 0 },
    });

    const saved = await fetch(`${base}/api/observers`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify({ enabled: true, workers: 2 }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      settings: { enabled: true, workers: 2, maxRepairs: 5 },
      workers: { running: [], waiting: 0 },
    });

    const refused = await fetch(`${base}/api/observers`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify({ workers: 0 }),
    });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({
      errors: [expect.objectContaining({ path: 'workers' })],
    });

    const wrongShape = await fetch(`${base}/api/observers`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify([1]),
    });
    expect(wrongShape.status).toBe(400);
  });

  it('forbids or allows the observer in a run', async () => {
    const { h, web, base } = await setup();
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.finished);
    const post = (id: string, body: unknown) =>
      fetch(`${base}/api/runs/${id}/observer`, {
        method: 'POST',
        headers: authed(web, JSON_TYPE),
        body: JSON.stringify(body),
      });
    const forbidden = await post(runId, { enabled: false });
    expect(forbidden.status).toBe(200);
    expect(((await forbidden.json()) as RunView).repair?.allowed).toBe(false);
    expect((await post(runId, { enabled: 'no' })).status).toBe(400);
    expect((await post('nope', { enabled: false })).status).toBe(404);
  });

  it('forwards the observers event to the browser and drops incident', async () => {
    const { h, web, base } = await setup();
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, {
      headers: authed(web),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      const deadline = Date.now() + 10_000;
      while (!text.includes(needle) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil('"snapshot"');
    h.script({ code: [{ exitCode: 1, noReport: true }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.finished);
    await h.call('observers_set', { settings: { workers: 2 } });
    await readUntil('"observers"');
    controller.abort();
    expect(text).toContain('"event":"observers"');
    expect(text).not.toContain('"event":"incident"');
  });
});
