import { afterEach, describe, expect, it } from 'vitest';

import { httpMcpTransport } from '../../../src/feature/service-registry/clients/http-mcp/index.ts';
import { LinkRepository } from '../../../src/feature/service-registry/repositories/index.ts';
import { RegistryCalls } from '../../../src/feature/service-registry/services/calls.ts';
import { serviceRegistryAdapter } from '../../../src/feature/service-registry/services/index.ts';
import { RegistryLinks } from '../../../src/feature/service-registry/services/links.ts';
import { AUTO_LINK_INTERVAL_MS } from '../../../src/feature/service-registry/types/index.ts';
import { startFakeRegistry, type FakeRegistry } from '../../fakes/registry-api.ts';
import { fixture, type Fixture } from '../integrations/helpers.ts';

let registry: FakeRegistry | null = null;
afterEach(async () => {
  await registry?.close();
  registry = null;
});

const PROJECT = '/work/app';

interface Setup {
  f: Fixture;
  fake: FakeRegistry;
  links: RegistryLinks;
  connection: string;
  origins: Record<string, string | null>;
  clock: { now: number };
}

async function setup(): Promise<Setup> {
  const fake = (registry = await startFakeRegistry());
  fake.projects = [];
  const clock = { now: 1_000_000 };
  const f = fixture({
    adapters: [serviceRegistryAdapter({ transport: httpMcpTransport, proxyFor: () => null })],
    now: () => clock.now,
  });
  const view = await f.services.connections.add({
    kind: 'service-registry',
    name: 'main',
    global: true,
    params: { url: fake.base },
  });
  await f.services.connections.setSecret(view.id, 'token', fake.token);
  await f.services.connections.enable(view.id);
  const origins: Record<string, string | null> = {
    [PROJECT]: 'git@github.com:acme/api.git',
  };
  const links = new RegistryLinks({
    links: new LinkRepository(f.database),
    origins: { originOf: (path) => Promise.resolve(origins[path] ?? null) },
    repositories: f.registry,
    integrations: () => f.services,
    calls: new RegistryCalls({ transport: httpMcpTransport, proxyFor: () => null }),
    now: () => clock.now,
  });
  return { f, fake, links, connection: view.id, origins, clock };
}

const calls = (fake: FakeRegistry, tool: string) =>
  fake.requests.filter(
    (request) =>
      request.body?.method === 'tools/call' &&
      (request.body.params as { name?: string }).name === tool,
  ).length;

describe('automatic link by origin', () => {
  it('links an ssh origin to the https repo_url of one project', async () => {
    const { fake, links, connection } = await setup();
    fake.projects = [
      { path: 'acme/backend/api', name: 'api', repo_url: 'https://github.com/acme/api' },
      { path: 'acme/web', name: 'web', repo_url: 'https://github.com/acme/web' },
    ];
    const link = await links.autoLink(PROJECT, connection, 'command');
    expect(link).toMatchObject({
      status: 'linked',
      registryPath: 'acme/backend/api',
      source: 'auto',
    });
    expect(links.find(PROJECT, connection)).toEqual(link);
  });

  it('names every candidate when several projects share the repo_url', async () => {
    const { fake, links, connection } = await setup();
    fake.projects = [
      { path: 'acme/a', name: 'a', repo_url: 'https://github.com/acme/api.git' },
      { path: 'acme/b', name: 'b', repo_url: 'ssh://git@github.com/acme/api' },
    ];
    const link = await links.autoLink(PROJECT, connection, 'command');
    expect(link).toMatchObject({ status: 'ambiguous', registryPath: null, source: null });
    expect(link.candidates).toEqual(['acme/a', 'acme/b']);
  });

  it('records no_match when nothing matches or the project has no origin', async () => {
    const { fake, links, connection, origins } = await setup();
    fake.projects = [{ path: 'acme/x', name: 'x', repo_url: 'https://github.com/acme/x' }];
    expect((await links.autoLink(PROJECT, connection, 'command')).status).toBe('no_match');
    origins[PROJECT] = null;
    expect((await links.autoLink(PROJECT, connection, 'command')).status).toBe('no_match');
  });

  it('reads the catalog page by page', async () => {
    const { fake, links, connection } = await setup();
    fake.pageSize = 2;
    fake.projects = [
      ...Array.from({ length: 5 }, (_, index) => ({
        path: `acme/p${index}`,
        name: `p${index}`,
        repo_url: `https://github.com/acme/p${index}`,
      })),
      { path: 'acme/backend/api', name: 'api', repo_url: 'https://github.com/acme/api' },
    ];
    const link = await links.autoLink(PROJECT, connection, 'command');
    expect(link.registryPath).toBe('acme/backend/api');
    // three pages and the empty one that ends the catalog
    expect(calls(fake, 'list_projects')).toBe(4);
  });

  it('stops after 25 pages and says the catalog was cut', async () => {
    const { fake, links, connection } = await setup();
    fake.pageSize = 1;
    fake.projects = Array.from({ length: 40 }, (_, index) => ({
      path: `acme/p${index}`,
      name: `p${index}`,
      repo_url: `https://github.com/acme/p${index}`,
    }));
    const link = await links.autoLink(PROJECT, connection, 'command');
    expect(link.status).toBe('truncated');
    expect(calls(fake, 'list_projects')).toBe(25);
  });

  it('records unauthorized and unreachable without a link', async () => {
    const { fake, links, connection, clock } = await setup();
    fake.failWith = [401];
    expect((await links.autoLink(PROJECT, connection, 'command')).status).toBe('unauthorized');
    clock.now += 1;
    fake.failWith = [503];
    expect((await links.autoLink(PROJECT, connection, 'command')).status).toBe('unreachable');
  });

  it('keeps the link it has when the registry fails', async () => {
    const { fake, links, connection } = await setup();
    fake.projects = [
      { path: 'acme/backend/api', name: 'api', repo_url: 'https://github.com/acme/api' },
    ];
    await links.autoLink(PROJECT, connection, 'command');
    fake.failWith = [503];
    const again = await links.autoLink(PROJECT, connection, 'command');
    expect(again).toMatchObject({ status: 'linked', registryPath: 'acme/backend/api' });
  });

  it('asks again only after an hour when started by an attempt', async () => {
    const { fake, links, connection, clock } = await setup();
    fake.projects = [];
    await links.autoLink(PROJECT, connection, 'attempt');
    const first = calls(fake, 'list_projects');
    clock.now += 10 * 60 * 1000;
    expect((await links.autoLink(PROJECT, connection, 'attempt')).status).toBe('no_match');
    expect(calls(fake, 'list_projects')).toBe(first);
    clock.now += AUTO_LINK_INTERVAL_MS;
    fake.projects = [{ path: 'acme/api', name: 'api', repo_url: 'https://github.com/acme/api' }];
    expect((await links.autoLink(PROJECT, connection, 'attempt')).status).toBe('linked');
  });
});

describe('manual link', () => {
  it('is kept when the automatic matching would find another project', async () => {
    const { fake, links, connection } = await setup();
    fake.projects = [
      { path: 'acme/legacy/api', name: 'legacy', repo_url: 'https://example.com/legacy' },
      { path: 'acme/backend/api', name: 'api', repo_url: 'https://github.com/acme/api' },
    ];
    await links.manualLink(PROJECT, connection, 'acme/legacy/api');
    for (const trigger of ['command', 'enable', 'attempt'] as const) {
      const link = await links.autoLink(PROJECT, connection, trigger);
      expect(link).toMatchObject({ registryPath: 'acme/legacy/api', source: 'manual' });
    }
    expect(links.find(PROJECT, connection)?.registryPath).toBe('acme/legacy/api');
  });

  it('refuses a path the registry does not know and changes nothing', async () => {
    const { fake, links, connection } = await setup();
    fake.projects = [{ path: 'acme/api', name: 'api', repo_url: 'https://github.com/acme/api' }];
    await links.manualLink(PROJECT, connection, 'acme/api');
    await expect(links.manualLink(PROJECT, connection, 'acme/none')).rejects.toThrow(
      'project acme/none is not found in the service registry',
    );
    expect(links.find(PROJECT, connection)?.registryPath).toBe('acme/api');
  });

  it('refuses when the registry does not answer, with a static text', async () => {
    const { fake, links, connection } = await setup();
    fake.failWith = [503];
    await expect(links.manualLink(PROJECT, connection, 'acme/api')).rejects.toThrow(
      'the service registry is unreachable',
    );
    expect(links.find(PROJECT, connection)).toBeUndefined();
  });
});

describe('clearing', () => {
  it('removes the link and stops automatic matching until --auto', async () => {
    const { fake, links, connection, clock } = await setup();
    fake.projects = [{ path: 'acme/api', name: 'api', repo_url: 'https://github.com/acme/api' }];
    await links.autoLink(PROJECT, connection, 'command');
    expect(links.clear(PROJECT, connection)).toMatchObject({
      status: 'disabled',
      registryPath: null,
    });
    clock.now += 10 * AUTO_LINK_INTERVAL_MS;
    const before = calls(fake, 'list_projects');
    for (const trigger of ['enable', 'attempt'] as const) {
      expect((await links.autoLink(PROJECT, connection, trigger)).status).toBe('disabled');
    }
    expect(calls(fake, 'list_projects')).toBe(before);
    expect((await links.autoLink(PROJECT, connection, 'command')).status).toBe('linked');
  });
});

describe('the project for an attempt', () => {
  it('names the project and the server of the connection', async () => {
    const { fake, links } = await setup();
    fake.projects = [
      { path: 'acme/backend/api', name: 'api', repo_url: 'https://github.com/acme/api' },
    ];
    expect(await links.projectFor(PROJECT, [{ server: 'registry', connection: 'main' }])).toEqual({
      path: 'acme/backend/api',
      server: 'registry',
    });
  });

  it('is null without a link, without such a connection and when the registry fails', async () => {
    const { fake, links } = await setup();
    fake.projects = [];
    expect(
      await links.projectFor(PROJECT, [{ server: 'registry', connection: 'main' }]),
    ).toBeNull();
    expect(await links.projectFor(PROJECT, [{ server: 'x', connection: 'nope' }])).toBeNull();
    fake.failWith = [503];
    expect(
      await links.projectFor('/work/lib', [{ server: 'registry', connection: 'main' }]),
    ).toBeNull();
  });
});

describe('after the enabling of a connection', () => {
  it('matches every project the connection serves', async () => {
    const { fake, links, connection, origins } = await setup();
    origins['/work/lib'] = 'https://github.com/acme/lib';
    fake.projects = [
      { path: 'acme/api', name: 'api', repo_url: 'https://github.com/acme/api' },
      { path: 'acme/lib', name: 'lib', repo_url: 'https://github.com/acme/lib' },
    ];
    await links.autoLinkServed(connection);
    expect(links.list().map((link) => [link.project, link.registryPath])).toEqual([
      ['/work/app', 'acme/api'],
      ['/work/lib', 'acme/lib'],
    ]);
  });
});
