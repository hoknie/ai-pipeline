import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { databasePath, ensureDirectory } from '../../src/platform/paths/index.ts';
import { Database } from '../../src/platform/sqlite/index.ts';
import { ArtifactRepository } from '../../src/feature/artifacts/repositories/index.ts';
import { PatchRepository } from '../../src/feature/delivery/repositories/index.ts';
import { ObserverRepository } from '../../src/feature/observers/repositories/index.ts';
import { QueueRepository } from '../../src/feature/queue/repositories/index.ts';
import { KnownRepositories } from '../../src/feature/repos/repositories/index.ts';
import { FinishedRunRepository, RunRepository } from '../../src/feature/runs/repositories/index.ts';
import { TagRepository } from '../../src/feature/tags/repositories/index.ts';

/** A database with the repositories of every feature on it, the way `app` assembles them. */
export function openStorage(path: string) {
  const database = new Database(path);
  const runs = new RunRepository(database);
  return {
    database,
    runs,
    finished: new FinishedRunRepository(database, runs),
    queues: new QueueRepository(database),
    known: new KnownRepositories(database),
    tags: new TagRepository(database),
    patches: new PatchRepository(database),
    artifacts: new ArtifactRepository(database),
    observers: new ObserverRepository(database),
  };
}

export type Storage = ReturnType<typeof openStorage>;

/** What the scenario of removing a tag does: one transaction, each repository changes its own table. */
export function removeTag(storage: Storage, repository: string, id: string): void {
  storage.database.transaction(() => {
    storage.tags.deleteTag(repository, id);
    storage.runs.dropTag(repository, id);
    storage.queues.dropItemTag(repository, id);
  });
}

/** The next task number of a repository comes from the larger of the two counts. */
export function maxTaskNumber(storage: Storage, repository: string): number {
  return Math.max(storage.runs.maxNumber(repository), storage.queues.maxItemNumber(repository));
}

/** A fresh database in a temporary state directory. */
export function temporaryStorage(): Storage {
  const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
  const storage = openStorage(databasePath(directory));
  storage.database.exec('PRAGMA synchronous = OFF');
  return storage;
}

/** Gives a database built from the current schema the column names of the builds before the rename. */
export function renameBack(database: import('node:sqlite').DatabaseSync): void {
  database.exec(
    'DROP INDEX IF EXISTS attempts_history_order; DROP INDEX IF EXISTS runs_history_repository;',
  );
  dropQueueFilter(database);
  dropProjectAttributes(database);
  for (const table of ['runs', 'queue_items']) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some((column) => column.name === 'pipeline')) {
      database.exec(`ALTER TABLE ${table} RENAME COLUMN pipeline TO workflow`);
    }
  }
}

/** Takes away the project attributes of the registry, the last migration, when they are there. */
export function dropProjectAttributes(database: import('node:sqlite').DatabaseSync): void {
  const columns = database.prepare('PRAGMA table_info(repositories)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'slug')) return;
  database.exec('DROP INDEX IF EXISTS repositories_by_slug');
  for (const column of ['name', 'slug', 'enabled', 'color']) {
    database.exec(`ALTER TABLE repositories DROP COLUMN ${column}`);
  }
}

/** Takes away the columns of the newest migrations (the variants and the take filter), when they are there. */
export function dropQueueFilter(database: import('node:sqlite').DatabaseSync): void {
  // The attachments migration is the newest: it goes first.
  database.exec('DROP TABLE IF EXISTS attachments');
  dropColumn(database, 'runs', 'attachments_json');
  for (const table of ['runs', 'queue_items']) {
    const have = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (have.some((column) => column.name === 'variant')) {
      database.exec(`ALTER TABLE ${table} DROP COLUMN variant`);
    }
  }
  const columns = database.prepare('PRAGMA table_info(queues)').all() as { name: string }[];
  if (columns.some((column) => column.name === 'filter_json')) {
    database.exec('ALTER TABLE queues DROP COLUMN filter_json');
  }
}

function dropColumn(database: import('node:sqlite').DatabaseSync, table: string, name: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((column) => column.name === name)) {
    database.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
  }
}
