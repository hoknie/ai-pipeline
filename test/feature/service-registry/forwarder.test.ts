import { afterEach, describe, expect, it } from 'vitest';

import { httpMcpTransport } from '../../../src/feature/service-registry/clients/http-mcp/index.ts';
import {
  Forwarder,
  serviceRegistryAdapter,
} from '../../../src/feature/service-registry/services/index.ts';
import { RegistryFailure } from '../../../src/feature/service-registry/types/index.ts';
import { startFakeRegistry, type FakeRegistry } from '../../fakes/registry-api.ts';
import { SENTINEL, fixture, type Fixture } from '../integrations/helpers.ts';

let registry: FakeRegistry | null = null;
afterEach(async () => {
  await registry?.close();
  registry = null;
});

async function setup(): Promise<{ f: Fixture; fake: FakeRegistry; forwarder: Forwarder }> {
  const fake = (registry = await startFakeRegistry());
  const f = fixture({
    adapters: [serviceRegistryAdapter({ transport: httpMcpTransport, proxyFor: () => null })],
  });
  const forwarder = new Forwarder({
    transport: httpMcpTransport,
    proxyFor: () => null,
    integrations: () => f.services,
  });
  return { f, fake, forwarder };
}

async function add(
  f: Fixture,
  fake: FakeRegistry,
  scope: { global: true } | { repository: string },
  enable = true,
): Promise<string> {
  const view = await f.services.connections.add({
    kind: 'service-registry',
    name: 'main',
    ...scope,
    params: { url: fake.base },
  });
  await f.services.connections.setSecret(view.id, 'token', fake.token);
  if (enable) await f.services.connections.enable(view.id);
  return view.id;
}

const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

describe('connections of a server of a specialist', () => {
  it('prefers the connection of the project and falls back to the shared one', async () => {
    const { f, fake, forwarder } = await setup();
    expect(forwarder.resolve('/work/app', 'main')).toBe('unavailable');
    await add(f, fake, { global: true });
    expect(forwarder.resolve('/work/app', 'main')).toBe('ok');
    const own = await add(f, fake, { repository: '/work/app' }, false);
    // the project one wins even though it is not enabled
    expect(forwarder.resolve('/work/app', 'main')).toBe('disabled');
    expect(forwarder.resolve('/work/lib', 'main')).toBe('ok');
    await f.services.connections.enable(own);
    expect(forwarder.resolve('/work/app', 'main')).toBe('ok');
  });

  it('does not serve a project from the connection of another project', async () => {
    const { f, fake, forwarder } = await setup();
    await add(f, fake, { repository: '/work/lib' });
    expect(forwarder.resolve('/work/app', 'main')).toBe('unavailable');
    await expect(
      forwarder.forward({
        session: 's',
        project: '/work/app',
        connection: 'main',
        server: 'reg',
        message: list,
      }),
    ).rejects.toMatchObject({ code: 'connection_disabled' });
    expect(fake.requests).toEqual([]);
  });

  it('reads the secret for the call and answers secret_unavailable when the store fails', async () => {
    const { f, fake, forwarder } = await setup();
    await add(f, fake, { global: true });
    const answer = await forwarder.forward({
      session: 's',
      project: '/work/app',
      connection: 'main',
      server: 'reg',
      message: list,
    });
    expect(answer).toMatchObject({ id: 1 });
    f.store.down = true;
    const failure = await forwarder
      .forward({
        session: 's',
        project: '/work/app',
        connection: 'main',
        server: 'reg',
        message: list,
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RegistryFailure);
    expect(failure).toMatchObject({ code: 'secret_unavailable' });
    expect(JSON.stringify(failure)).not.toContain(SENTINEL);
  });

  it('refuses a message that is not an object before anything else', async () => {
    const { f, fake, forwarder } = await setup();
    await add(f, fake, { global: true });
    for (const message of ['x', null, [list]]) {
      await expect(
        forwarder.forward({
          session: 's',
          project: '/work/app',
          connection: 'main',
          server: 'reg',
          message,
        }),
      ).rejects.toMatchObject({ code: 'protocol' });
    }
    expect(fake.requests).toEqual([]);
  });

  it('keeps one registry session per attempt and closes it once', async () => {
    const { f, fake, forwarder } = await setup();
    await add(f, fake, { global: true });
    const call = (session: string, message: object) =>
      forwarder.forward({
        session,
        project: '/work/app',
        connection: 'main',
        server: 'reg',
        message,
      });
    await call('a', { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await call('a', list);
    await call('b', { jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(fake.requests.map((one) => one.sessionId)).toEqual([undefined, 'session-1', undefined]);
    await forwarder.close('a');
    await forwarder.close('a');
    expect(fake.closed).toEqual(['session-1']);
    await forwarder.close('b');
    expect(fake.closed).toEqual(['session-1', 'session-2']);
  });

  it('keeps separate sessions for two servers of one attempt and closes both', async () => {
    const { f, fake, forwarder } = await setup();
    await add(f, fake, { global: true });
    const call = (server: string, message: object) =>
      forwarder.forward({
        session: 'a',
        server,
        project: '/work/app',
        connection: 'main',
        message,
      });
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize' };
    await call('one', init);
    await call('two', init);
    await call('one', list);
    await call('two', list);
    expect(fake.requests.map((one) => one.sessionId)).toEqual([
      undefined,
      undefined,
      'session-1',
      'session-2',
    ]);
    await forwarder.close('a');
    expect([...fake.closed].sort()).toEqual(['session-1', 'session-2']);
  });
});
