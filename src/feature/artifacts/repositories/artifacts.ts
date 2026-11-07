import type { Database, Row } from '../../../platform/sqlite/index.ts';

/** A file a specialist published for a group; the bytes live outside the database. */
export interface ArtifactRecord {
  id: string;
  runId: string;
  group: string;
  step: string;
  /** Number of the attempt that published it. */
  seq: number;
  specialist: string;
  title: string;
  fileName: string;
  size: number;
  uri: string;
  createdAt: number;
}

function artifactRecord(row: Row): ArtifactRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    group: String(row.group_slug),
    step: String(row.step_id),
    seq: Number(row.seq),
    specialist: String(row.specialist),
    title: String(row.title),
    fileName: String(row.file_name),
    size: Number(row.size),
    uri: String(row.uri),
    createdAt: Number(row.created_at),
  };
}

export class ArtifactRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** The artifact the same attempt already published under that file name, if any. */
  findArtifact(runId: string, group: string, seq: number, fileName: string): ArtifactRecord | null {
    const row = this.database
      .prepare(
        'SELECT * FROM artifacts WHERE run_id = ? AND group_slug = ? AND seq = ? AND file_name = ?',
      )
      .get(runId, group, seq, fileName) as Row | undefined;
    return row ? artifactRecord(row) : null;
  }

  /**
   * Records an artifact; the same attempt publishing the same file name again replaces the
   * earlier record (its `id` stays). Returns the stored record and the URI it replaced.
   */
  addArtifact(record: ArtifactRecord): { artifact: ArtifactRecord; previousUri: string | null } {
    return this.database.transaction(() => {
      const before = this.findArtifact(record.runId, record.group, record.seq, record.fileName);
      this.database
        .prepare(
          `INSERT INTO artifacts (id, run_id, group_slug, step_id, seq, specialist, title, file_name, size, uri, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (run_id, group_slug, seq, file_name) DO UPDATE SET
             title = excluded.title, size = excluded.size, uri = excluded.uri,
             created_at = excluded.created_at, specialist = excluded.specialist,
             step_id = excluded.step_id`,
        )
        .run(
          record.id,
          record.runId,
          record.group,
          record.step,
          record.seq,
          record.specialist,
          record.title,
          record.fileName,
          record.size,
          record.uri,
          record.createdAt,
        );
      const artifact = this.findArtifact(record.runId, record.group, record.seq, record.fileName);
      return { artifact: artifact!, previousUri: before?.uri ?? null };
    });
  }

  /** Artifacts of a group, newest first. */
  artifacts(runId: string, group: string): ArtifactRecord[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM artifacts WHERE run_id = ? AND group_slug = ? ORDER BY created_at DESC, rowid DESC',
        )
        .all(runId, group) as Row[]
    ).map(artifactRecord);
  }

  artifact(runId: string, id: string): ArtifactRecord | null {
    const row = this.database
      .prepare('SELECT * FROM artifacts WHERE run_id = ? AND id = ?')
      .get(runId, id) as Row | undefined;
    return row ? artifactRecord(row) : null;
  }

  artifactCount(runId: string, group: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS n FROM artifacts WHERE run_id = ? AND group_slug = ?')
      .get(runId, group) as Row;
    return Number(row.n);
  }

  /** Number of artifacts per group of a run. */
  artifactCounts(runId: string): Map<string, { count: number; revision: number }> {
    const rows = this.database
      .prepare(
        'SELECT group_slug, COUNT(*) AS n, MAX(created_at) AS at, SUM(size) AS bytes FROM artifacts WHERE run_id = ? GROUP BY group_slug',
      )
      .all(runId) as Row[];
    return new Map(
      rows.map((row) => [
        String(row.group_slug),
        { count: Number(row.n), revision: Number(row.at) + Number(row.bytes) },
      ]),
    );
  }

  /** URIs of all artifacts by run, for sweeping the storage. */
  artifactUris(): Map<string, string[]> {
    const uris = new Map<string, string[]>();
    for (const row of this.database.prepare('SELECT run_id, uri FROM artifacts').all() as Row[]) {
      const run = String(row.run_id);
      uris.set(run, [...(uris.get(run) ?? []), String(row.uri)]);
    }
    return uris;
  }
}
