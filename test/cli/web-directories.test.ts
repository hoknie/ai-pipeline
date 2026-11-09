import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listDirectory } from '../../src/presentation/web/panel/directories.ts';

function home(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-directories-')));
  mkdirSync(join(base, 'code', 'lib'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', join(base, 'code', 'app')]);
  mkdirSync(join(base, 'code', '.hidden'));
  writeFileSync(join(base, 'code', 'notes.txt'), 'x');
  return base;
}

describe('listDirectory', () => {
  it('lists the subdirectories without hidden ones and marks the repository roots', () => {
    const base = home();
    const listing = listDirectory('~/code', base);
    expect(listing).toMatchObject({
      path: join(base, 'code'),
      parent: base,
      home: base,
      git: false,
      truncated: false,
    });
    expect(listing.entries).toEqual([
      { name: 'app', path: join(base, 'code', 'app'), git: true },
      { name: 'lib', path: join(base, 'code', 'lib'), git: false },
    ]);
  });

  it('opens the home directory without a path and refuses a missing or relative one', () => {
    const base = home();
    expect(listDirectory(null, base).path).toBe(base);
    expect(() => listDirectory(join(base, 'gone'), base)).toThrow('is not a directory');
    expect(() => listDirectory('code', base)).toThrow('path must be absolute');
  });
});
