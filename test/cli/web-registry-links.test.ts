import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionView, ProjectLinkView } from '../../src/presentation/ipc/contract/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';
import { startFakeRegistry, type FakeRegistry } from '../fakes/registry-api.ts';
import { MemoryStore } from '../feature/integrations/helpers.ts';
import { harness, type Harness } from '../daemon/harness.ts';

let h: Harness | null = null;
let web: WebServer | null = null;
let fake: FakeRegistry | null = null;

afterEach(async () => {
  await web?.close();
  await h?.close();
  await fake?.close();
  web = h = fake = null;
});

async function setup() {
  fake = await startFakeRegistry();
  fake.projects = [
    { path: 'acme/backend/api', name: 'api', repo_url: 'https://github.com/acme/api' },
  ];
  h = await harness(undefined, {}, { integrations: { secretStore: new MemoryStore() } });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/api.git'], { cwd: h.repo });
  await h.call('repository_add', { path: h.repo });
  web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
  const base = `http://127.0.0.1:${web.port}`;
  const headers = { 'x-aip-token': web.token ?? '', 'content-type': 'application/json' };
  const added = (await h.call('integration_add', {
    kind: 'service-registry',
    name: 'main',
    global: true,
    params: { url: fake.base },
  })) as ConnectionView;
  await h.call('integration_secret_set', { id: added.id, slot: 'token', value: fake.token });
  await h.call('integration_enable', { id: added.id });
  return {
    id: added.id,
    get: (path: string) => fetch(`${base}${path}`, { headers }),
    post: (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
  };
}

describe('the links of a project in the panel', () => {
  it('links, reads, refuses a wrong path with the text of the daemon and clears', async () => {
    const { id, get, post } = await setup();
    const auto = await post('/api/integrations/link', { id, repository: h!.repo, auto: true });
    expect(auto.status).toBe(200);
    expect(((await auto.json()) as ProjectLinkView).registryPath).toBe('acme/backend/api');
    const read = await get(`/api/integrations/links?repository=${encodeURIComponent(h!.repo)}`);
    expect(((await read.json()) as ProjectLinkView[]).map((one) => one.status)).toEqual(['linked']);
    const wrong = await post('/api/integrations/link', {
      id,
      repository: h!.repo,
      path: 'acme/none',
    });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(((await wrong.json()) as { error: string }).error).toBe(
      'project acme/none is not found in the service registry',
    );
    const two = await post('/api/integrations/link', { id, repository: h!.repo });
    expect(two.status).toBe(400);
    const cleared = await post('/api/integrations/link', { id, repository: h!.repo, clear: true });
    expect(((await cleared.json()) as ProjectLinkView).status).toBe('disabled');
  });
});
