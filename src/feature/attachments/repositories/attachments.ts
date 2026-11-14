import type { Database, Row } from '../../../platform/sqlite/index.ts';

/** A file attached to a task; the bytes live outside the database, at `uri`. */
export interface AttachmentRecord {
  id: string;
  repository: string;
  /** The queue item the file was attached to; it stays after the item became a run. */
  itemId: string;
  /** The run the item became; null while the item waits in the queue. */
  runId: string | null;
  fileName: string;
  size: number;
  mediaType: string;
  uri: string;
  createdAt: number;
}

function record(row: Row): AttachmentRecord {
  return {
    id: String(row.id),
    repository: String(row.repository),
    itemId: String(row.item_id),
    runId: row.run_id === null || row.run_id === undefined ? null : String(row.run_id),
    fileName: String(row.file_name),
    size: Number(row.size),
    mediaType: String(row.media_type),
    uri: String(row.uri),
    createdAt: Number(row.created_at),
  };
}

export class AttachmentRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Records the attachments and deletes the records `removing` names, together or not at all. */
  add(records: AttachmentRecord[], removing: string[] = []): void {
    this.database.transaction(() => {
      for (const id of removing)
        this.database.prepare('DELETE FROM attachments WHERE id = ?').run(id);
      for (const item of records) {
        this.database
          .prepare(
            `INSERT INTO attachments (id, repository, item_id, run_id, file_name, size, media_type, uri, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            item.id,
            item.repository,
            item.itemId,
            item.runId,
            item.fileName,
            item.size,
            item.mediaType,
            item.uri,
            item.createdAt,
          );
      }
    });
  }

  /** The attachments of a queue item, in the order they were attached. */
  ofItem(itemId: string): AttachmentRecord[] {
    return (
      this.database
        .prepare('SELECT * FROM attachments WHERE item_id = ? ORDER BY created_at, rowid')
        .all(itemId) as Row[]
    ).map(record);
  }

  /** The attachments of a run, in the order they were attached. */
  ofRun(runId: string): AttachmentRecord[] {
    return (
      this.database
        .prepare('SELECT * FROM attachments WHERE run_id = ? ORDER BY created_at, rowid')
        .all(runId) as Row[]
    ).map(record);
  }

  /** The attachment by its id, whoever owns it. */
  byId(id: string): AttachmentRecord | null {
    const row = this.database.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as
      Row | undefined;
    return row ? record(row) : null;
  }

  /** The attachment of a run by its id. */
  inRun(runId: string, id: string): AttachmentRecord | null {
    const row = this.database
      .prepare('SELECT * FROM attachments WHERE run_id = ? AND id = ?')
      .get(runId, id) as Row | undefined;
    return row ? record(row) : null;
  }

  /** The attachments of the item now belong to the run. */
  bindToRun(itemId: string, runId: string): void {
    this.database
      .prepare('UPDATE attachments SET run_id = ? WHERE item_id = ? AND run_id IS NULL')
      .run(runId, itemId);
  }

  /** Deletes the records of the item that no run owns; returns them. */
  removeOfItem(itemId: string, names?: string[]): AttachmentRecord[] {
    return this.database.transaction(() => {
      const removed = this.ofItem(itemId).filter(
        (item) => item.runId === null && (names === undefined || names.includes(item.fileName)),
      );
      for (const item of removed) {
        this.database.prepare('DELETE FROM attachments WHERE id = ?').run(item.id);
      }
      return removed;
    });
  }

  /** Deletes records by id. */
  removeRecords(ids: string[]): void {
    this.database.transaction(() => {
      for (const id of ids) this.database.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    });
  }

  all(): AttachmentRecord[] {
    return (this.database.prepare('SELECT * FROM attachments').all() as Row[]).map(record);
  }
}
