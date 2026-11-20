import { afterEach, describe, expect, it } from 'vitest';

import type {
  ConnectionView,
  RegistrySkillView,
} from '../../src/presentation/ipc/contract/index.ts';
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
  fake.skills.push(
    {
      id: 'sk-1',
      name: 'go-testing',
      versions: { '1.0.0': Buffer.alloc(0), '1.2.0': Buffer.alloc(0) },
    },
    { id: 'sk-2', name: 'sql-review', versions: { '2.0.0': Buffer.alloc(0) } },
  );
  h = await harness(undefined, {}, { integrations: { secretStore: new MemoryStore() } });
  web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
  const added = (await h.call('integration_add', {
    kind: 'service-registry',
    name: 'main',
    global: true,
    params: { url: fake.base },
  })) as ConnectionView;
  await h.call('integration_secret_set', { id: added.id, slot: 'token', value: fake.token });
  await h.call('integration_enable', { id: added.id });
  const base = `http://127.0.0.1:${web.port}`;
  return { base, token: web.token ?? '' };
}

describe('the panel API of registry skills', () => {
  it('is protected like the rest of the API', async () => {
    const { base } = await setup();
    expect((await fetch(`${base}/api/integrations/skills`)).status).toBe(401);
  });

  it('lists the skills of the registry of the project for the hints', async () => {
    const { base, token } = await setup();
    const get = (path: string) => fetch(`${base}${path}`, { headers: { 'x-aip-token': token } });
    const all = (await (await get('/api/integrations/skills')).json()) as RegistrySkillView[];
    expect(all.map((one) => one.name)).toEqual(['go-testing', 'sql-review']);
    const found = (await (
      await get('/api/integrations/skills?query=go')
    ).json()) as RegistrySkillView[];
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'go-testing', versions: ['1.2.0', '1.0.0'] });
    expect(JSON.stringify(found)).not.toContain(fake!.token);
  });

  it('answers with an error text, not a hang, when the registry is down', async () => {
    const { base, token } = await setup();
    await fake!.close();
    fake = null;
    const response = await fetch(`${base}/api/integrations/skills`, {
      headers: { 'x-aip-token': token },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).toContain('cannot list skills');
  });
});
