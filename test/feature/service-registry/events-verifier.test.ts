import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { InboundRequest } from '../../../src/feature/integrations/services/index.ts';
import { LinkRepository } from '../../../src/feature/service-registry/repositories/index.ts';
import { registryVerifier } from '../../../src/feature/service-registry/services/events.ts';
import { serviceRegistryDescriptor } from '../../../src/feature/service-registry/types/index.ts';
import { fixture, SENTINEL, type Fixture } from '../integrations/helpers.ts';

const KEY = Buffer.from('registry-signing-key-24b');
const SECRET = `whsec_${KEY.toString('base64')}`;
const NOW = 1_700_000_000_000;
const PATH = 'acme/backend/api';

interface World {
  f: Fixture;
  id: string;
  links: LinkRepository;
  deliver(
    id: string,
    body: unknown,
    overrides?: Partial<InboundRequest> & { at?: number },
  ): Promise<unknown>;
}

async function world(
  params: Record<string, string> = { on_deployment_drift: 'investigate' },
  withSecret = true,
): Promise<World> {
  let services: Fixture['services'] | undefined;
  const holder: { links?: LinkRepository } = {};
  const f = fixture({
    now: () => NOW,
    adapters: [
      {
        descriptor: serviceRegistryDescriptor,
        verifier: registryVerifier({
          links: { byPath: (c, p) => holder.links!.byPath(c, p) },
          access: () => services!.access,
        }),
      },
    ],
  });
  services = f.services;
  holder.links = new LinkRepository(f.database);
  const created = await f.services.connections.add({
    kind: 'service-registry',
    name: 'main',
    global: true,
    params: { url: 'https://registry.example.com', ...params },
  });
  await f.services.connections.setSecret(created.id, 'token', 'api-token');
  if (withSecret) await f.services.connections.setSecret(created.id, 'webhook_secret', SECRET);
  await f.services.connections.enable(created.id);
  holder.links.put({
    project: '/work/app',
    connectionId: created.id,
    registryPath: PATH,
    source: 'manual',
    status: 'linked',
    candidates: [],
    matchedAt: 1,
  });
  const deliver = (
    id: string,
    body: unknown,
    { at = NOW, ...overrides }: Partial<InboundRequest> & { at?: number } = {},
  ) => {
    const raw = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
    const timestamp = String(at / 1000);
    const mac = createHmac('sha256', KEY)
      .update(`${id}.${timestamp}.`)
      .update(raw)
      .digest('base64');
    return f.services.inbound.receive({
      verifier: 'service-registry',
      connectionId: created.id,
      body: raw,
      headers: {
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${mac}`,
      },
      ...overrides,
    });
  };
  return { f, id: created.id, links: holder.links, deliver };
}

const drift = (path = PATH) => ({
  type: 'deployment.drift',
  data: { node: { path }, environment: 'prod', expected_version: '2', actual_version: '1' },
});

describe('verifier of the events of a service registry', () => {
  it('queues a task in the linked project for a signed drift and remembers the id', async () => {
    const w = await world();
    const seen: unknown[] = [];
    const outcome = await w.deliver('msg_1', drift(), { onVerified: (meta) => seen.push(meta) });
    expect(outcome).toMatchObject({ status: 'applied', connectionId: w.id });
    expect(w.f.performed).toHaveLength(1);
    expect(w.f.performed[0]).toMatchObject({
      project: '/work/app',
      operation: {
        type: 'queue_task',
        pipeline: 'investigate',
        skipDuplicate: true,
        title: 'Registry: deployment.drift — acme/backend/api',
      },
    });
    expect(seen).toEqual([{ type: 'deployment.drift', path: PATH }]);
    expect(await w.deliver('msg_1', drift())).toMatchObject({ status: 'duplicate' });
    expect(w.f.performed).toHaveLength(1);
  });

  it.each([
    ['link.check_failed', 'no_rule'],
    ['deployment.drift_resolved', 'recovery'],
    ['link.check_recovered', 'recovery'],
    ['repo_sync.recovered', 'recovery'],
    ['node.created', 'unsupported'],
    ['constructor', 'unsupported'],
    ['toString', 'unsupported'],
  ])('ignores %s with the reason %s', async (type, reason) => {
    const w = await world();
    const outcome = await w.deliver('msg_1', { type, data: { node: { path: PATH } } });
    expect(outcome).toEqual({ status: 'ignored', connectionId: w.id, reason });
    expect(w.f.performed).toEqual([]);
  });

  it('ignores an event of a path nobody is linked to, and of a path two projects share', async () => {
    const w = await world();
    expect(await w.deliver('msg_1', drift('acme/other'))).toMatchObject({
      status: 'ignored',
      reason: 'no_link',
    });
    w.links.put({
      project: '/work/lib',
      connectionId: w.id,
      registryPath: PATH,
      source: 'manual',
      status: 'linked',
      candidates: [],
      matchedAt: 1,
    });
    expect(await w.deliver('msg_2', drift())).toMatchObject({
      status: 'ignored',
      reason: 'ambiguous_link',
    });
    expect(w.f.performed).toEqual([]);
  });

  it.each([
    ['not json', '{nope'],
    ['not an object', '[1]'],
    ['no type', JSON.stringify({ data: { node: { path: PATH } } })],
    ['no node path', JSON.stringify({ type: 'deployment.drift', data: { node: {} } })],
    [
      'a path that is not text',
      JSON.stringify({ type: 'deployment.drift', data: { node: { path: 5 } } }),
    ],
  ])('ignores a signed body that is %s as malformed', async (_name, body) => {
    const w = await world();
    expect(await w.deliver('msg_1', body)).toMatchObject({
      status: 'ignored',
      reason: 'malformed',
    });
    expect(w.f.performed).toEqual([]);
  });

  it('refuses a missing secret, a wrong signature, a stale time and no headers alike', async () => {
    const bare = await world({ on_deployment_drift: 'investigate' }, false);
    const w = await world();
    const messages: string[] = [];
    const attempt = async (promise: Promise<unknown>) => {
      messages.push(
        await promise.then(
          () => 'accepted',
          (error: Error) => error.message,
        ),
      );
    };
    await attempt(bare.deliver('msg_1', drift()));
    await attempt(
      w.deliver('msg_1', drift(), {
        headers: {
          'webhook-id': 'msg_1',
          'webhook-timestamp': '1',
          'webhook-signature': 'v1,AA==',
        },
      }),
    );
    await attempt(w.deliver('msg_1', drift(), { at: NOW - 6 * 60 * 1000 }));
    await attempt(w.deliver('msg_1', drift(), { at: NOW + 6 * 60 * 1000 }));
    await attempt(w.deliver('msg_1', drift(), { headers: {} }));
    await attempt(w.deliver('msg_1', drift(), { connectionId: 'missing' }));
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toMatch(/authentication failed/);
    expect(messages[0]).not.toContain(SENTINEL);
    expect(bare.f.performed).toEqual([]);
    expect(w.f.performed).toEqual([]);
  });

  it('does not claim the id of an event that failed authentication', async () => {
    const w = await world();
    await expect(
      w.deliver('msg_1', drift(), { headers: { 'webhook-id': 'msg_1' } }),
    ).rejects.toThrow(/authentication failed/);
    expect(await w.deliver('msg_1', drift())).toMatchObject({ status: 'applied' });
  });

  it('answers unavailable, not unauthenticated, while the secret storage is down', async () => {
    const w = await world();
    w.f.store.down = true;
    await expect(w.deliver('msg_1', drift())).rejects.toMatchObject({
      code: 'integrations.backend_unavailable',
    });
    w.f.store.down = false;
    expect(w.f.performed).toEqual([]);
    expect(await w.deliver('msg_1', drift())).toMatchObject({ status: 'applied' });
  });

  it('answers a repeat of an ignored event as a duplicate', async () => {
    const w = await world();
    const body = { type: 'repo_sync.recovered', data: { node: { path: PATH } } };
    expect(await w.deliver('msg_1', body)).toMatchObject({ status: 'ignored' });
    expect(await w.deliver('msg_1', body)).toMatchObject({ status: 'duplicate' });
  });
});
