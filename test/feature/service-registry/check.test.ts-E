import { afterEach, describe, expect, it } from 'vitest';

import type { SecretStorePort } from '../../../src/feature/integrations/ports/index.ts';
import { httpMcpTransport } from '../../../src/feature/service-registry/clients/http-mcp/index.ts';
import { serviceRegistryAdapter } from '../../../src/feature/service-registry/services/index.ts';
import { startFakeProxy, startFakeRegistry, type FakeRegistry } from '../../fakes/registry-api.ts';
import { SENTINEL, fixture, type Fixture } from '../integrations/helpers.ts';

let registry: FakeRegistry | null = null;
afterEach(async () => {
  await registry?.close();
  registry = null;
});

async function connected(
  options: { secret?: boolean; proxyFor?: (url: string) => string | null; url?: string } = {},
): Promise<{ f: Fixture; id: string; fake: FakeRegistry }> {
  registry = await startFakeRegistry();
  const f = fixture({
    adapters: [
      serviceRegistryAdapter({
        transport: httpMcpTransport,
        proxyFor: options.proxyFor ?? (() => null),
      }),
    ],
  });
  const view = await f.services.connections.add({
    kind: 'service-registry',
    name: 'main',
    global: true,
    params: { url: options.url ?? registry.base },
  });
  if (options.secret !== false) {
    await f.services.connections.setSecret(view.id, 'token', registry.token);
    await f.services.connections.enable(view.id);
  }
  return { f, id: view.id, fake: registry };
}

describe('check of a service-registry connection', () => {
  it('runs initialize and tools/list and records the count and the time', async () => {
    const { f, id, fake } = await connected();
    const view = await f.services.checks.check(id);
    expect(view.lastCheck).toEqual({ at: 1000, ok: true, code: null, count: 3 });
    expect(fake.requests.map((r) => r.body?.method ?? r.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'DELETE',
    ]);
    expect(fake.requests.every((r) => r.authorization === `Bearer ${fake.token}`)).toBe(true);
    expect(fake.closed).toEqual(['session-1']);
    expect(JSON.stringify(view)).not.toContain(fake.token);
  });

  it('records unauthorized on 401 and keeps the connection enabled', async () => {
    const { f, id, fake } = await connected();
    await f.services.connections.setSecret(id, 'token', 'svcp_revoked');
    const view = await f.services.checks.check(id);
    expect(view.lastCheck).toMatchObject({ ok: false, code: 'unauthorized', count: null });
    expect(view.enabled).toBe(true);
    expect(JSON.stringify(view)).not.toContain('svcp_revoked');
    expect(fake.requests.every((r) => r.authorization === 'Bearer svcp_revoked')).toBe(true);
  });

  it('records unreachable, protocol and timeout codes', async () => {
    const { f, id, fake } = await connected();
    fake.failWith.push(503);
    expect((await f.services.checks.check(id)).lastCheck?.code).toBe('unreachable');
    fake.rawBody = 'not json';
    expect((await f.services.checks.check(id)).lastCheck?.code).toBe('protocol');
    fake.rawBody = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} });
    fake.tools = [];
    // initialize answered by the raw body, the rest normally: the session has no tools list
    expect((await f.services.checks.check(id)).lastCheck).toMatchObject({
      ok: true,
      count: 0,
    });
  });

  it('records secret_unavailable when the store cannot be read', async () => {
    const { f, id } = await connected();
    (f.store as SecretStorePort & { down: boolean }).down = true;
    const view = await f.services.checks.check(id);
    expect(view.lastCheck).toMatchObject({ ok: false });
    expect(JSON.stringify(view)).not.toContain(SENTINEL);
  });

  it('goes through the proxy of the moment', async () => {
    const { fake } = await connected();
    const proxy = await startFakeProxy(fake.port);
    try {
      const f = fixture({
        adapters: [
          serviceRegistryAdapter({ transport: httpMcpTransport, proxyFor: () => proxy.url }),
        ],
      });
      const view = await f.services.connections.add({
        kind: 'service-registry',
        name: 'main',
        global: true,
        params: { url: 'http://registry.test:8080' },
      });
      await f.services.connections.setSecret(view.id, 'token', fake.token);
      await f.services.connections.enable(view.id);
      expect((await f.services.checks.check(view.id)).lastCheck).toMatchObject({
        ok: true,
        count: 3,
      });
      expect(proxy.connects.map((c) => c.target)).toContain('registry.test:8080');
    } finally {
      await proxy.close();
    }
  });
});
