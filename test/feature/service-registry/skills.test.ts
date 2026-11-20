import { mkdtempSync, existsSync, readFileSync, readdirSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpMcpTransport } from '../../../src/feature/service-registry/clients/http-mcp/index.ts';
import {
  SkillService,
  serviceRegistryAdapter,
} from '../../../src/feature/service-registry/services/index.ts';
import { RegistryFailure } from '../../../src/feature/service-registry/types/index.ts';
import { startFakeRegistry, type FakeRegistry, type FakeSkill } from '../../fakes/registry-api.ts';
import { buildZip } from '../../fakes/zip.ts';
import { fixture, type Fixture } from '../integrations/helpers.ts';

const registries: FakeRegistry[] = [];
afterEach(async () => {
  while (registries.length > 0) await registries.pop()?.close();
});

const manifest = (name: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: test\n---\nBody ${extra}\n`;

function archive(name: string, extra = ''): Buffer {
  return buildZip([
    { name: `${name}/` },
    { name: `${name}/SKILL.md`, data: manifest(name, extra) },
    { name: `${name}/scripts/run.sh`, data: 'echo run\n' },
  ]);
}

function skill(name: string, versions: string[], id = `id-${name}`): FakeSkill {
  return {
    id,
    name,
    versions: Object.fromEntries(versions.map((version) => [version, archive(name, version)])),
  };
}

interface Setup {
  f: Fixture;
  service: SkillService;
  clock: { now: number };
  directory: string;
}

function setup(): Setup {
  const f = fixture({
    adapters: [serviceRegistryAdapter({ transport: httpMcpTransport, proxyFor: () => null })],
  });
  const directory = mkdtempSync(join(tmpdir(), 'aip-skills-'));
  const clock = { now: Date.now() };
  const service = new SkillService({
    transport: httpMcpTransport,
    proxyFor: () => null,
    integrations: () => f.services,
    cacheDirectory: join(directory, 'cache'),
    now: () => clock.now,
  });
  return { f, service, clock, directory };
}

async function connect(
  f: Fixture,
  name: string,
  scope: { global: true } | { repository: string },
  registry?: FakeRegistry,
): Promise<{ id: string; fake: FakeRegistry }> {
  const fake = registry ?? (await startFakeRegistry());
  if (registry === undefined) registries.push(fake);
  const view = await f.services.connections.add({
    kind: 'service-registry',
    name,
    ...scope,
    params: { url: fake.base },
  });
  await f.services.connections.setSecret(view.id, 'token', fake.token);
  await f.services.connections.enable(view.id);
  return { id: view.id, fake };
}

describe('registry skills: connection', () => {
  it('prefers the connection of the project to a shared one', async () => {
    const { f, service } = setup();
    const shared = await connect(f, 'main', { global: true });
    const own = await connect(f, 'team', { repository: '/work/app' });
    shared.fake.skills.push(skill('go-testing', ['1.0.0']));
    own.fake.skills.push(skill('go-testing', ['1.4.1']));
    const result = await service.pin('/work/app', ['registry:go-testing@^1']);
    expect(result.pinned).toEqual([{ name: 'go-testing', version: '1.4.1', connection: own.id }]);
    expect(shared.fake.requests).toEqual([]);
    // another project has no own connection: the shared one
    const other = await service.pin('/work/lib', ['registry:go-testing']);
    expect(other.pinned[0]).toMatchObject({ version: '1.0.0', connection: shared.id });
  });

  it('refuses with two shared connections and none of the project', async () => {
    const { f, service } = setup();
    await connect(f, 'main', { global: true });
    await connect(f, 'other', { global: true });
    const result = await service.pin('/work/app', ['registry:go-testing']);
    expect(result.pinned).toEqual([]);
    expect(result.problems).toEqual([
      'skill not found: registry:go-testing (several shared service-registry connections; add one to the project)',
    ]);
  });

  it('refuses without any connection', async () => {
    const { service } = setup();
    const result = await service.pin('/work/app', ['registry:go-testing']);
    expect(result.problems[0]).toContain('no service-registry connection');
  });
});

describe('registry skills: version and cache', () => {
  it('selects the highest version of the range and finds the exact name on a later page', async () => {
    const { f, service, directory } = setup();
    const { fake, id } = await connect(f, 'main', { global: true });
    fake.pageSize = 1;
    fake.skills.push(
      skill('go-testing-extra', ['9.0.0']),
      skill('go-testing', ['1.2.0', '1.4.1', '2.0.0']),
    );
    const result = await service.pin('/work/app', ['registry:go-testing@^1']);
    expect(result.pinned).toEqual([{ name: 'go-testing', version: '1.4.1', connection: id }]);
    expect(fake.downloads).toEqual(['id-go-testing@1.4.1']);
    const kept = join(directory, 'cache', id, 'go-testing', '1.4.1');
    expect(readFileSync(join(kept, 'scripts', 'run.sh'), 'utf8')).toBe('echo run\n');
    expect(readdirSync(join(directory, 'cache', id, 'go-testing'))).toEqual(['1.4.1']);
  });

  it('names the available versions when none matches', async () => {
    const { f, service } = setup();
    const { fake } = await connect(f, 'main', { global: true });
    fake.skills.push(skill('go-testing', ['2.0.0', '2.1.0']));
    const result = await service.pin('/work/app', ['registry:go-testing@^1']);
    expect(result.problems).toEqual([
      'skill not found: registry:go-testing@^1 (no available version matches ^1 (available: 2.1.0, 2.0.0))',
    ]);
  });

  it('reports a skill the registry does not have', async () => {
    const { f, service } = setup();
    const { fake } = await connect(f, 'main', { global: true });
    fake.skills.push(skill('go-testing-extra', ['1.0.0']));
    const result = await service.pin('/work/app', ['registry:go-testing']);
    expect(result.problems[0]).toContain('not found in the registry');
  });

  it('serves a version from the cache without the network', async () => {
    const { f, service, directory } = setup();
    const { fake, id } = await connect(f, 'main', { global: true });
    fake.skills.push(skill('go-testing', ['1.4.1']));
    await service.pin('/work/app', ['registry:go-testing@^1']);
    const before = fake.requests.length;
    const target = join(directory, 'attempt');
    const problems = await service.materialize(
      '/work/app',
      [{ name: 'go-testing', version: '1.4.1', connection: id }],
      target,
    );
    expect(problems).toEqual([]);
    expect(fake.requests).toHaveLength(before);
    expect(existsSync(join(target, '.claude', 'skills', 'go-testing', 'SKILL.md'))).toBe(true);
    // the registry goes away: a pin of the same range still finds the cached version
    await fake.close();
    registries.splice(registries.indexOf(fake), 1);
    const again = await service.pin('/work/app', ['registry:go-testing@^1']);
    expect(again.pinned).toEqual([{ name: 'go-testing', version: '1.4.1', connection: id }]);
    expect(again.problems).toEqual([]);
  });

  it('answers unreachable when the registry is down and nothing is cached', async () => {
    const { f, service } = setup();
    const { fake } = await connect(f, 'main', { global: true });
    await fake.close();
    registries.splice(registries.indexOf(fake), 1);
    const result = await service.pin('/work/app', ['registry:go-testing']);
    expect(result.pinned).toEqual([]);
    expect(result.problems).toEqual(['skill not found: registry:go-testing (unreachable)']);
  });

  it('answers unauthorized for a rejected token', async () => {
    const { f, service } = setup();
    const { fake } = await connect(f, 'main', { global: true });
    fake.failWith = [401, 401, 401, 401];
    const result = await service.pin('/work/app', ['registry:go-testing']);
    expect(result.problems).toEqual(['skill not found: registry:go-testing (unauthorized)']);
  });

  it.each([
    ['a path leaving the folder', buildZip([{ name: 'go-testing/../../.bashrc', data: 'x' }])],
    [
      'a manifest of another name',
      buildZip([{ name: 'go-testing/SKILL.md', data: manifest('other') }]),
    ],
    [
      'a top folder of another name',
      buildZip([{ name: 'other/SKILL.md', data: manifest('go-testing') }]),
    ],
    ['no manifest', buildZip([{ name: 'go-testing/readme.md', data: 'x' }])],
    [
      'two top folders',
      buildZip([
        { name: 'go-testing/SKILL.md', data: manifest('go-testing') },
        { name: 'x/y', data: 'x' },
      ]),
    ],
    ['garbage', Buffer.from('not a zip, not a zip, not a zip')],
  ])('writes nothing for an archive with %s', async (_label, bytes) => {
    const { f, service, directory } = setup();
    const { fake, id } = await connect(f, 'main', { global: true });
    fake.skills.push({ id: 'id-go-testing', name: 'go-testing', versions: { '1.0.0': bytes } });
    const result = await service.pin('/work/app', ['registry:go-testing@^1']);
    expect(result.problems).toEqual(['skill not found: registry:go-testing@^1 (invalid archive)']);
    const parent = join(directory, 'cache', id, 'go-testing');
    expect(existsSync(parent) ? readdirSync(parent) : []).toEqual([]);
    expect(existsSync(join(directory, '.bashrc'))).toBe(false);
  });

  it('gives the list and the archive of one skill a single time budget', async () => {
    const { f, service } = setup();
    const { fake } = await connect(f, 'main', { global: true });
    fake.skills.push(skill('go-testing', ['1.4.1']));
    const spy = vi.spyOn(AbortSignal, 'timeout');
    try {
      await service.pin('/work/app', ['registry:go-testing@^1']);
      expect(spy.mock.calls.filter(([ms]) => ms === 60_000)).toHaveLength(1);
      expect(fake.downloads).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to the cache when the token cannot be read', async () => {
    const { f, service } = setup();
    const { fake, id } = await connect(f, 'main', { global: true });
    fake.skills.push(skill('go-testing', ['1.4.1']));
    await service.pin('/work/app', ['registry:go-testing@^1']);
    const secrets = f.services.secrets;
    const read = vi.spyOn(secrets, 'read').mockRejectedValue(new Error('locked'));
    try {
      const again = await service.pin('/work/app', ['registry:go-testing@^1']);
      expect(again.pinned).toEqual([{ name: 'go-testing', version: '1.4.1', connection: id }]);
    } finally {
      read.mockRestore();
    }
  });

  it('reports an invalid reference without asking the registry', async () => {
    const { f, service } = setup();
    const { fake } = await connect(f, 'main', { global: true });
    const result = await service.pin('/work/app', ['registry:Bad Name']);
    expect(result.problems).toEqual(['skill not found: registry:Bad Name (invalid reference)']);
    expect(fake.requests).toEqual([]);
  });
});

describe('registry skills: listing', () => {
  it('lists the skills of a connection with their versions', async () => {
    const { f, service } = setup();
    const { fake, id } = await connect(f, 'main', { global: true });
    fake.skills.push(skill('go-testing', ['1.0.0', '1.1.0']), skill('sql', ['2.0.0']));
    const byId = await service.list({ connection: id }, 'go');
    expect(byId.map((one) => one.name)).toEqual(['go-testing']);
    expect(byId[0]?.versions).toEqual(['1.1.0', '1.0.0']);
    const byProject = await service.list({ project: '/work/app' }, '');
    expect(byProject.map((one) => one.name)).toEqual(['go-testing', 'sql']);
  });

  it('fails with a readable error when the connection is unknown', async () => {
    const { service } = setup();
    await expect(service.list({ project: '/work/app' }, '')).rejects.toThrow(/no service-registry/);
  });
});

describe('registry skills: cache cleaning', () => {
  it('removes versions nobody used for 30 days, by the substituted clock', async () => {
    const { f, service, clock, directory } = setup();
    const { fake, id } = await connect(f, 'main', { global: true });
    fake.skills.push(skill('go-testing', ['1.0.0', '1.1.0']));
    await service.pin('/work/app', ['registry:go-testing@1.0.0']);
    await service.pin('/work/app', ['registry:go-testing@1.1.0']);
    const day = 24 * 60 * 60 * 1000;
    const old = new Date(clock.now - 40 * day);
    const used = join(directory, 'cache', id, 'go-testing', '1.0.0');
    utimesSync(used, old, old);
    utimesSync(join(directory, 'cache', id, 'go-testing', '1.1.0'), old, old);
    // using a version counts: it stays
    service.cache.has(id, 'go-testing', '1.1.0');
    expect(service.cache.prune()).toBe(1);
    expect(readdirSync(join(directory, 'cache', id, 'go-testing'))).toEqual(['1.1.0']);
    clock.now += 31 * day;
    expect(service.cache.prune()).toBe(1);
    expect(existsSync(join(directory, 'cache', id, 'go-testing'))).toBe(false);
    expect(statSync(join(directory, 'cache')).isDirectory()).toBe(true);
  });
});

describe('registry download', () => {
  it('downloads with the bearer token, refuses a bad token and times out', async () => {
    const fake = await startFakeRegistry();
    registries.push(fake);
    fake.skills.push(skill('go-testing', ['1.0.0']));
    const endpoint = { base: fake.base, token: fake.token, proxyFor: () => null };
    const path = '/api/v1/skills/id-go-testing/archive?version=1.0.0';
    const bytes = await httpMcpTransport.download(endpoint, path, 1024 * 1024);
    expect(bytes.equals(fake.skills[0]!.versions['1.0.0']!)).toBe(true);
    expect(fake.requests.at(-1)?.authorization).toBe(`Bearer ${fake.token}`);
    await expect(
      httpMcpTransport.download({ ...endpoint, token: 'wrong' }, path, 1024),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(httpMcpTransport.download(endpoint, path, 10)).rejects.toMatchObject({
      code: 'too_large',
    });
    fake.delayMs = 500;
    const slow = httpMcpTransport.download({ ...endpoint, timeoutMs: 50 }, path, 1024 * 1024);
    await expect(slow).rejects.toBeInstanceOf(RegistryFailure);
    await expect(slow).rejects.toMatchObject({ code: 'timeout' });
    fake.delayMs = 0;
  });
});

describe('registry skills: the daemon job', () => {
  it('clears the cache at the start and every day', async () => {
    const { vi } = await import('vitest');
    const { createSkillCachePruner, SKILL_CACHE_PRUNE_MS } =
      await import('../../../src/app/lifecycle.ts');
    vi.useFakeTimers();
    try {
      const { f, service, clock, directory } = setup();
      const { fake, id } = await connect(f, 'main', { global: true });
      fake.skills.push(skill('go-testing', ['1.0.0']));
      await service.pin('/work/app', ['registry:go-testing']);
      const pruner = createSkillCachePruner(
        { serviceRegistry: { skills: service } } as never,
        () => undefined,
      );
      pruner.start();
      expect(existsSync(join(directory, 'cache', id, 'go-testing', '1.0.0'))).toBe(true);
      clock.now += 31 * 24 * 60 * 60 * 1000;
      vi.advanceTimersByTime(SKILL_CACHE_PRUNE_MS);
      expect(existsSync(join(directory, 'cache', id, 'go-testing', '1.0.0'))).toBe(false);
      pruner.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
