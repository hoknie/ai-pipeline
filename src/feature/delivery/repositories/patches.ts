import type { Database, Row } from '../../../platform/sqlite/index.ts';

/** Where the patch of a run is kept; the bytes live outside the database. */
export interface RunPatchRecord {
  uri: string;
  /** The run ref commit the patch was built from. */
  commit: string;
  size: number;
  createdAt: number;
}

export class PatchRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  runPatch(runId: string): RunPatchRecord | null {
    const row = this.database.prepare('SELECT * FROM run_patches WHERE run_id = ?').get(runId) as
      Row | undefined;
    return row
      ? {
          uri: String(row.uri),
          commit: String(row.commit_id),
          size: Number(row.size),
          createdAt: Number(row.created_at),
        }
      : null;
  }

  setRunPatch(runId: string, record: RunPatchRecord): void {
    this.database
      .prepare(
        `INSERT INTO run_patches (run_id, uri, commit_id, size, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (run_id) DO UPDATE SET uri = excluded.uri, commit_id = excluded.commit_id,
           size = excluded.size, created_at = excluded.created_at`,
      )
      .run(runId, record.uri, record.commit, record.size, record.createdAt);
  }

  runPatchIds(): string[] {
    return (this.database.prepare('SELECT run_id FROM run_patches').all() as Row[]).map((row) =>
      String(row.run_id),
    );
  }
}
