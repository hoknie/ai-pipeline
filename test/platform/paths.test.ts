import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  databasePath,
  ensureDirectory,
  expandHome,
  socketPath,
  stateDirectory,
} from '../../src/platform/paths/index.ts';
import { openStorage } from '../feature/storage.ts';

describe('state directory', () => {
  it('lives under XDG_STATE_HOME or ~/.local/state', () => {
    expect(stateDirectory('/xdg', '/home/u')).toBe('/xdg/aip');
    expect(stateDirectory(undefined, '/home/u')).toBe('/home/u/.local/state/aip');
    expect(stateDirectory('relative', '/home/u')).toBe('/home/u/.local/state/aip');
  });

  it('is created with mode 0700 and holds the database', () => {
    const directory = ensureDirectory(
      join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'state', 'aip'),
    );
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    openStorage(databasePath(directory)).database.close();
    expect(statSync(databasePath(directory)).isFile()).toBe(true);
  });
});

describe('socket path', () => {
  it('stays in the state directory when short and moves to a short temporary path otherwise', () => {
    expect(socketPath('/home/u/.local/state/aip')).toBe('/home/u/.local/state/aip/aip.sock');
    const long = `/${'x'.repeat(120)}/aip`;
    const path = socketPath(long, '/tmp');
    expect(path).toMatch(/^\/tmp\/aip-[0-9a-f]{16}\.sock$/);
    expect(socketPath(long, '/tmp')).toBe(path);
  });
});

describe('expandHome', () => {
  it('writes ~ and ~/… under the home directory and keeps any other path', () => {
    expect(expandHome('~', '/home/me')).toBe('/home/me');
    expect(expandHome('~/projects/app', '/home/me')).toBe('/home/me/projects/app');
    expect(expandHome('/srv/app', '/home/me')).toBe('/srv/app');
    expect(expandHome('~other/app', '/home/me')).toBe('~other/app');
  });
});
