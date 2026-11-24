import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS, SCHEMA_VERSION, migrate } from '../../../src/platform/sqlite/index.ts';

describe('migration that adds the result of the last check of a connection', () => {
  it('adds the table of results to an older database, keeps its connections and is repeatable', () => {
    const old = new DatabaseSync(':memory:');
    MIGRATIONS.slice(0, -5).forEach((sql) => old.exec(sql));
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 5}`);
    old
      .prepare(
        `INSERT INTO integration_connections
           (id, kind, name, scope, project_path, params_json, enabled, state, created_at, updated_at)
         VALUES ('c1', 'telegram', 'main', 'global', NULL, '{}', 1, 'ready', 1, 1)`,
      )
      .run();
    migrate(old);
    expect(old.prepare('SELECT id, enabled FROM integration_connections').all()).toEqual([
      { id: 'c1', enabled: 1 },
    ]);
    expect(old.prepare('SELECT * FROM integration_connection_checks').all()).toEqual([]);
    // a database whose version was set back runs the migration again without harm
    old.exec('ALTER TABLE runs DROP COLUMN cleaned_at');
    old.exec('ALTER TABLE runs DROP COLUMN pinned_skills_json');
    old.exec('ALTER TABLE queue_items DROP COLUMN inherit_tags');
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 5}`);
    migrate(old);
    expect(
      (old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(SCHEMA_VERSION);
    old.close();
  });
});
