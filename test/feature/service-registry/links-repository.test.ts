import { describe, expect, it } from 'vitest';

import { LinkRepository } from '../../../src/feature/service-registry/repositories/index.ts';
import type { ProjectLink } from '../../../src/feature/service-registry/types/index.ts';
import { exampleAdapter, fixture } from '../integrations/helpers.ts';

const link = (overrides: Partial<ProjectLink> = {}): ProjectLink => ({
  project: '/work/app',
  connectionId: 'c1',
  registryPath: 'acme/backend/api',
  source: 'auto',
  status: 'linked',
  candidates: [],
  matchedAt: 5,
  ...overrides,
});

async function setup() {
  const f = fixture({ adapters: [exampleAdapter()] });
  const first = await f.services.connections.add({ kind: 'example', name: 'one', global: true });
  const second = await f.services.connections.add({ kind: 'example', name: 'two', global: true });
  return { f, repository: new LinkRepository(f.database), one: first.id, two: second.id };
}

describe('links repository', () => {
  it('keeps one row per pair and replaces it', async () => {
    const { repository, one, two } = await setup();
    repository.put(link({ connectionId: one }));
    repository.put(link({ connectionId: one, registryPath: 'acme/legacy/api', source: 'manual' }));
    repository.put(
      link({
        connectionId: two,
        registryPath: null,
        source: null,
        status: 'ambiguous',
        candidates: ['a', 'b'],
      }),
    );
    expect(repository.find('/work/app', one)).toMatchObject({
      registryPath: 'acme/legacy/api',
      source: 'manual',
    });
    expect(repository.find('/work/app', two)).toMatchObject({
      status: 'ambiguous',
      candidates: ['a', 'b'],
    });
    expect(repository.all('/work/app')).toHaveLength(2);
    expect(repository.all('/work/lib')).toEqual([]);
  });

  it('finds the linked projects of a connection by the path in the registry', async () => {
    const { repository, one, two } = await setup();
    repository.put(link({ connectionId: one }));
    expect(repository.byPath(one, 'acme/backend/api').map((found) => found.project)).toEqual([
      '/work/app',
    ]);
    repository.put(link({ connectionId: one, project: '/work/lib' }));
    expect(repository.byPath(one, 'acme/backend/api').map((found) => found.project)).toEqual([
      '/work/app',
      '/work/lib',
    ]);
    expect(repository.byPath(two, 'acme/backend/api')).toEqual([]);
    expect(repository.byPath(one, 'acme/other')).toEqual([]);
    repository.put(
      link({ connectionId: two, registryPath: null, source: null, status: 'no_match' }),
    );
    repository.put(link({ connectionId: two, project: '/work/lib', status: 'disabled' }));
    expect(repository.byPath(two, 'acme/backend/api')).toEqual([]);
  });

  it('survives a restart of the database', async () => {
    const { f, repository, one } = await setup();
    repository.put(link({ connectionId: one }));
    expect(new LinkRepository(f.database).find('/work/app', one)).toEqual(
      link({ connectionId: one }),
    );
  });

  it('moves with the project and is forgotten with it', async () => {
    const { repository, one } = await setup();
    repository.put(link({ connectionId: one }));
    repository.moveProject('/work/app', '/work/new');
    expect(repository.find('/work/app', one)).toBeUndefined();
    expect(repository.find('/work/new', one)?.registryPath).toBe('acme/backend/api');
    repository.forgetProject('/work/new');
    expect(repository.all()).toEqual([]);
  });

  it('goes with the connection when it is removed', async () => {
    const { f, repository, one, two } = await setup();
    repository.put(link({ connectionId: one }));
    repository.put(link({ connectionId: two }));
    await f.services.connections.remove(one);
    expect(repository.all().map((row) => row.connectionId)).toEqual([two]);
  });
});
