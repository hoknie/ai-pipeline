import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { KnownRepositories } from '../../../src/feature/repos/repositories/index.ts';
import { createReposServices } from '../../../src/feature/repos/services/index.ts';
import { Database } from '../../../src/platform/sqlite/index.ts';

function repository(base: string, name: string): string {
  const path = join(base, name);
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: path });
  return path;
}

function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-registry-')));
  const database = new Database(join(base, 'state.db'));
  const changes: string[] = [];
  let now = 0;
  const services = createReposServices({
    database,
    now: () => (now += 1),
    publish: { repositoriesChanged: () => changes.push('changed') },
  });
  return { base, database, changes, ...services };
}

describe('registry of repositories', () => {
  it('lists the paths sorted, whatever the order they were added in', async () => {
    const { base, database, changes, registry } = setup();
    try {
      for (const name of ['zeta', 'alpha', 'mid']) await registry.rootOf(repository(base, name));
      expect(registry.entries().map((entry) => entry.path)).toEqual(
        ['zeta', 'alpha', 'mid'].map((name) => join(base, name)),
      );
      expect(registry.paths()).toEqual(['alpha', 'mid', 'zeta'].map((name) => join(base, name)));
      await registry.rootOf(join(base, 'alpha'));
      expect(changes).toHaveLength(3);

      registry.forget(join(base, 'mid'));
      expect(registry.has(join(base, 'mid'))).toBe(false);
      expect(changes).toHaveLength(4);
    } finally {
      database.close();
    }
  });

  it('gives a new project a free slug from its directory and finds it by the slug', async () => {
    const { base, database, registry } = setup();
    try {
      const first = await registry.rootOf(repository(base, 'one/My App'));
      const second = await registry.rootOf(repository(base, 'two/my-app'));
      expect(registry.entry(first)).toMatchObject({ slug: 'my-app', enabled: true, name: null });
      expect(registry.entry(second)?.slug).toBe('my-app-2');
      expect(await registry.rootOf('my-app-2')).toBe(second);
      expect(await registry.resolve('my-app')).toBe(first);
      await expect(registry.rootOf('nope')).rejects.toThrow('unknown project `nope`');
      expect(registry.entries()).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it('gives the projects of an older registry slugs in the order they were added', () => {
    const { database } = setup();
    try {
      const known = new KnownRepositories(database);
      known.addRepository('/a/app', 9);
      known.addRepository('/work/app', 5);
      const { registry } = createReposServices({
        database,
        now: () => 1,
        publish: { repositoriesChanged: () => {} },
      });
      registry.load();
      expect(registry.entry('/work/app')).toMatchObject({ slug: 'app', enabled: true });
      expect(registry.entry('/a/app')?.slug).toBe('app-2');
      expect(known.repositories().map((entry) => entry.slug)).toEqual(['app-2', 'app']);
    } finally {
      database.close();
    }
  });

  it('changes the attributes, refuses a taken slug and forgets the old one', async () => {
    const { base, database, registry, projects } = setup();
    try {
      const app = await registry.rootOf(repository(base, 'app'));
      const lib = await registry.rootOf(repository(base, 'lib'));
      await expect(projects.update(lib, { slug: 'app' })).rejects.toThrow(
        'project slug `app` is taken',
      );
      expect(registry.entry(lib)?.slug).toBe('lib');
      await projects.update('app', { slug: 'shop', name: '  Магазин ', color: 'teal' });
      expect(registry.entry(app)).toMatchObject({ slug: 'shop', name: 'Магазин', color: 'teal' });
      await expect(registry.rootOf('app')).rejects.toThrow('unknown project `app`');
      await projects.update('shop', { name: null });
      expect(registry.entry(app)?.name).toBeNull();
      await expect(projects.update(join(base, 'none'), { name: 'x' })).rejects.toThrow(
        /unknown repository/,
      );
      await projects.update('shop', { enabled: false });
      expect(() => registry.requireEnabled(app)).toThrow('project `shop` is disabled');
      expect(() => registry.requireEnabled(lib)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it('adds a project with attributes and refuses attributes for a known one', async () => {
    const { base, database, registry, projects } = setup();
    try {
      const app = await projects.add(repository(base, 'app'));
      mkdirSync(join(repository(base, 'new'), 'src'));
      const root = await projects.add(join(base, 'new/src'), { name: 'New', slug: 'fresh' });
      expect(root).toBe(join(base, 'new'));
      expect(registry.entry(root)).toMatchObject({ name: 'New', slug: 'fresh' });
      await expect(projects.add(repository(base, 'other'), { slug: 'app' })).rejects.toThrow(
        'project slug `app` is taken',
      );
      expect(registry.has(join(base, 'other'))).toBe(false);
      expect(await projects.add(app)).toBe(app);
      await expect(projects.add(app, { name: 'X' })).rejects.toThrow(
        'repository is already registered',
      );
    } finally {
      database.close();
    }
  });
});
