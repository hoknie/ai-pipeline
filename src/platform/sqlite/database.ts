import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { migrate } from './migrations.ts';

/**
 * The SQLite database of the state directory: opened and migrated here, shared by the repositories
 * of the features. `transaction` does not nest: a scenario that opens one calls only methods
 * without a transaction of their own.
 */
export class Database {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    this.connection = new DatabaseSync(path);
    migrate(this.connection);
  }

  prepare(sql: string): StatementSync {
    return this.connection.prepare(sql);
  }

  exec(sql: string): void {
    this.connection.exec(sql);
  }

  close(): void {
    this.connection.close();
  }

  transaction<T>(work: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
}
