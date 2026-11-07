import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { createReposServices } from '../../../src/feature/repos/services/index.ts';
import { Database } from '../../../src/platform/sqlite/index.ts';

function repository(base: string, name: string): string {
  const path = join(base, name);
  mkdirSync(path);
  execFileSync('git', ['init', '-q'], { cwd: path });
  return path;
}

describe('registry of repositories', () => {
  it('lists the paths sorted, whatever the order they were added in', async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-registry-')));
    const database = new Database(join(base, 'state.db'));
    const changes: string[] = [];
    let now = 0;
    const { registry } = createReposServices({
      database,
      now: () => (now += 1),
      publish: { repositoriesChanged: () => changes.push('changed') },
    });
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
});
