import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Database } from '../../../src/platform/sqlite/index.ts';

function open(): Database {
  const database = new Database(join(mkdtempSync(join(tmpdir(), 'aip-sqlite-')), 'state.db'));
  database.exec('PRAGMA synchronous = OFF');
  return database;
}

describe('Database.transaction', () => {
  it('commits what the work wrote and returns its result', () => {
    const database = open();
    const result = database.transaction(() => {
      database.prepare('INSERT INTO repositories (path, added_at) VALUES (?, ?)').run('/a', 1);
      return 'done';
    });
    expect(result).toBe('done');
    expect(database.prepare('SELECT path FROM repositories').all()).toEqual([{ path: '/a' }]);
    database.close();
  });

  it('rolls everything back when the work throws', () => {
    const database = open();
    expect(() =>
      database.transaction(() => {
        database.prepare('INSERT INTO repositories (path, added_at) VALUES (?, ?)').run('/a', 1);
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(database.prepare('SELECT path FROM repositories').all()).toEqual([]);
    database.close();
  });

  it('refuses a nested transaction and leaves the outer one intact', () => {
    const database = open();
    expect(() =>
      database.transaction(() => {
        database.prepare('INSERT INTO repositories (path, added_at) VALUES (?, ?)').run('/a', 1);
        database.transaction(() => undefined);
      }),
    ).toThrow(/within a transaction/);
    expect(database.prepare('SELECT path FROM repositories').all()).toEqual([]);
    database.transaction(() => undefined);
    database.close();
  });
});
