import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS, SCHEMA_VERSION, migrate } from '../../../src/platform/sqlite/index.ts';

describe('migration that adds the links to the projects of a service registry', () => {
  it('adds an empty table to an older database, keeps its connections and is repeatable', () => {
    const old = new DatabaseSync(':memory:');
    MIGRATIONS.slice(0, -5).forEach((sql) => old.exec(sql));
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 5}`);
    old
      .prepare(
        `INSERT INTO integration_connections
           (id, kind, name, scope, project_path, params_json, enabled, state, created_at, updated_at)
         VALUES ('c1', 'service-registry', 'main', 'global', NULL, '{}', 1, 'ready', 1, 1)`,
      )
      .run();
    migrate(old);
    expect(old.prepare('SELECT id FROM integration_connections').all()).toEqual([{ id: 'c1' }]);
    expect(old.prepare('SELECT * FROM service_registry_links').all()).toEqual([]);
    old.exec('ALTER TABLE runs DROP COLUMN cleaned_at');
    old.exec('ALTER TABLE queue_items DROP COLUMN inherit_tags');
    old.exec('ALTER TABLE runs DROP COLUMN harness');
    old.exec('ALTER TABLE runs DROP COLUMN probe_of');
    old.exec('ALTER TABLE queue_items DROP COLUMN delivery_branch_json');
    old.exec('ALTER TABLE runs DROP COLUMN delivery_branch_json');
    old.exec('ALTER TABLE runs DROP COLUMN source_commit');
    old.exec('ALTER TABLE runs DROP COLUMN source_branch');
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 5}`);
    migrate(old);
    expect(
      (old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(SCHEMA_VERSION);
    old.close();
  });

  it('removes the links of a connection with it', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    migrate(database);
    database
      .prepare(
        `INSERT INTO integration_connections
           (id, kind, name, scope, project_path, params_json, enabled, state, created_at, updated_at)
         VALUES ('c1', 'service-registry', 'main', 'global', NULL, '{}', 1, 'ready', 1, 1)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO service_registry_links (project_path, connection_id, status, matched_at)
         VALUES ('/work/app', 'c1', 'no_match', 1)`,
      )
      .run();
    database.exec("DELETE FROM integration_connections WHERE id = 'c1'");
    expect(database.prepare('SELECT * FROM service_registry_links').all()).toEqual([]);
    database.close();
  });
});
