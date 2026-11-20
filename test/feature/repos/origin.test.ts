import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createReposServices,
  type ProjectService,
} from '../../../src/feature/repos/services/index.ts';
import { databasePath, ensureDirectory } from '../../../src/platform/paths/index.ts';
import { Database } from '../../../src/platform/sqlite/index.ts';

function repository(origin?: string): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'aip-origin-')));
  execFileSync('git', ['init', '-q'], { cwd: path });
  if (origin !== undefined) execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: path });
  return path;
}

function projects(): ProjectService {
  const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-repos-')), 'aip'));
  const database = new Database(databasePath(directory));
  const { projects: service } = createReposServices({
    database,
    now: () => 1,
    publish: { repositoriesChanged: () => undefined },
  });
  return service;
}

describe('origin of a project', () => {
  it('is the address of the origin remote as the repository has it', async () => {
    const service = projects();
    expect(await service.originOf(repository('git@github.com:acme/api.git'))).toBe(
      'git@github.com:acme/api.git',
    );
  });

  it('is null without an origin or outside a repository', async () => {
    const service = projects();
    expect(await service.originOf(repository())).toBeNull();
    expect(await service.originOf(mkdtempSync(join(tmpdir(), 'aip-nogit-')))).toBeNull();
  });

  it('is the same address matchRemotes compares', async () => {
    const service = projects();
    const path = repository('git@github.com:acme/api.git');
    await service.add(path);
    expect((await service.matchRemotes(['https://github.com/acme/api']))?.path).toBe(path);
  });
});
