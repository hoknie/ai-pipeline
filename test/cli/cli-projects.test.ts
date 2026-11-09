import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { QueueView, RepositoryView } from '../../src/presentation/ipc/contract/index.ts';

import { aip, sandbox } from './sandbox.ts';

function otherRepository(name: string): string {
  const repo = join(realpathSync(mkdtempSync(join(tmpdir(), 'aip-cli-project-'))), name);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  return repo;
}

const listed = async (box: ReturnType<typeof sandbox>): Promise<RepositoryView[]> =>
  JSON.parse((await aip(box, 'repo', 'list', '--json')).stdout) as RepositoryView[];

describe('aip and project slugs', () => {
  it('takes a slug in --repo unless the current directory has an entry of that name', async () => {
    const box = sandbox();
    const other = otherRepository('other');
    expect((await aip(box, 'repo', 'add', other, '--slug', 'shop')).code).toBe(0);
    const bySlug = await aip(box, 'queue', 'list', '--repo', 'shop', '--json');
    expect(bySlug.code).toBe(0);
    expect((JSON.parse(bySlug.stdout) as QueueView).repository).toBe(other);
    // the current directory is the sandbox repository: its subdirectory wins over the slug
    mkdirSync(join(box.repo, 'shop'));
    const byPath = await aip(box, 'queue', 'list', '--repo', 'shop', '--json');
    expect((JSON.parse(byPath.stdout) as QueueView).repository).toBe(box.repo);
    const unknown = await aip(box, 'queue', 'list', '--repo', 'nope');
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('unknown project `nope`');
  });

  it('edits, lists and moves a project', async () => {
    const box = sandbox();
    const app = otherRepository('app');
    await aip(box, 'repo', 'add', app);
    const edited = await aip(box, 'repo', 'edit', 'app', '--name', 'Shop', '--color', 'teal');
    expect(edited.code).toBe(0);
    expect(await listed(box)).toMatchObject([
      { path: app, slug: 'app', name: 'Shop', color: 'teal', enabled: true },
    ]);
    await aip(box, 'repo', 'edit', 'app', '--disable', '--color', 'none');
    expect(await listed(box)).toMatchObject([{ slug: 'app', enabled: false, color: null }]);
    const table = await aip(box, 'repo', 'list');
    expect(table.stdout).toContain('SLUG  NAME  REPOSITORY');
    expect(table.stdout).toMatch(new RegExp(`app\\s+Shop\\s+${app}\\s+off\\s+0`));
    const moved = otherRepository('moved');
    expect((await aip(box, 'repo', 'move', 'app', moved)).code).toBe(0);
    expect(await listed(box)).toMatchObject([{ path: moved, slug: 'app', name: 'Shop' }]);
    await aip(box, 'repo', 'edit', 'app', '--no-name', '--enable');
    expect(await listed(box)).toMatchObject([{ name: null, label: 'moved', enabled: true }]);
  });

  it('refuses contradicting or missing flags without the daemon', async () => {
    const box = sandbox();
    const both = await aip(box, 'repo', 'edit', 'app', '--enable', '--disable');
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('only one of --enable and --disable');
    const none = await aip(box, 'repo', 'edit', 'app');
    expect(none.code).not.toBe(0);
    expect(none.stderr).toContain('pass at least one of');
  });
});
