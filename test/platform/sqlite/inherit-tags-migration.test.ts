import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { Database, MIGRATIONS, SCHEMA_VERSION } from '../../../src/platform/sqlite/index.ts';
import {
  QueueRepository,
  TaskLinksRepository,
} from '../../../src/feature/queue/repositories/index.ts';

function columns(database: DatabaseSync): string[] {
  return database
    .prepare('PRAGMA table_info(queue_items)')
    .all()
    .map((column) => String(column.name));
}

describe('migration that adds the tag inheritance of a queue item', () => {
  it('reads an item of an older database as inheriting and keeps a written refusal', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'aip-inherit-')), 'aip.db');
    const old = new DatabaseSync(path);
    MIGRATIONS.slice(0, -3).forEach((sql) => old.exec(sql));
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3}`);
    expect(columns(old)).not.toContain('inherit_tags');
    old
      .prepare(
        `INSERT INTO queues (repository, status, parallel, runs_json, acknowledged_json, updated_at)
         VALUES ('/repo', 'stopped', 1, '[]', '[]', 1)`,
      )
      .run();
    old
      .prepare(
        `INSERT INTO queue_items (id, repository, position, pipeline, task, created_at)
         VALUES ('q1', '/repo', 0, 'feature', 'a', 1)`,
      )
      .run();
    old.close();

    const database = new Database(path);
    const queues = new QueueRepository(database, new TaskLinksRepository(database));
    const loaded = queues.loadQueue('/repo');
    expect(loaded?.items[0]?.inheritTags).toBe(true);
    loaded!.items[0]!.inheritTags = false;
    queues.saveQueue(loaded!);
    expect(queues.loadQueue('/repo')?.items[0]?.inheritTags).toBe(false);
    database.close();
  });
});
