import type { Database } from '../../../platform/sqlite/index.ts';
import {
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  type AuditEvent,
  type AuditOutcome,
  type AuditQuery,
  type NewAuditEvent,
} from '../types/index.ts';

interface EventRow {
  id: number;
  at: number;
  subject: string;
  action: string;
  repository: string | null;
  resource_kind: string | null;
  resource_id: string | null;
  outcome: string;
  details_json: string;
  error: string | null;
}

function toEvent(row: EventRow): AuditEvent {
  return {
    id: row.id,
    at: row.at,
    subject: row.subject,
    action: row.action,
    repository: row.repository,
    resourceKind: row.resource_kind,
    resourceId: row.resource_id,
    outcome: row.outcome as AuditOutcome,
    details: JSON.parse(row.details_json) as Record<string, unknown>,
    error: row.error,
  };
}

/** `%` and `_` of a user's text must not act as wildcards in `LIKE`. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** The table `audit_events`: entries are only added and, when old, deleted. */
export class AuditEventsRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  insert(event: NewAuditEvent): number {
    const result = this.database
      .prepare(
        `INSERT INTO audit_events (at, subject, action, repository, resource_kind, resource_id, outcome, details_json, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.at,
        event.subject,
        event.action,
        event.repository,
        event.resourceKind,
        event.resourceId,
        event.outcome,
        JSON.stringify(event.details),
        event.error,
      );
    return Number(result.lastInsertRowid);
  }

  /** The entries the query selects, the newest first. */
  list(query: AuditQuery): AuditEvent[] {
    const where: string[] = [];
    const values: (string | number)[] = [];
    if (query.subject !== undefined) {
      where.push('subject = ?');
      values.push(query.subject);
    }
    if (query.repository !== undefined) {
      where.push('repository = ?');
      values.push(query.repository);
    }
    if (query.action !== undefined && query.action !== '') {
      where.push("action LIKE ? ESCAPE '\\'");
      values.push(`${escapeLike(query.action)}%`);
    }
    if (query.since !== undefined) {
      where.push('at >= ?');
      values.push(query.since);
    }
    const limit = Math.min(Math.max(1, query.limit ?? AUDIT_DEFAULT_LIMIT), AUDIT_MAX_LIMIT);
    const rows = this.database
      .prepare(
        `SELECT * FROM audit_events ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY at DESC, id DESC LIMIT ?`,
      )
      .all(...values, limit) as unknown as EventRow[];
    return rows.map(toEvent);
  }

  /** Deletes the entries older than `before`; returns how many. */
  prune(before: number): number {
    const result = this.database.prepare('DELETE FROM audit_events WHERE at < ?').run(before);
    return Number(result.changes);
  }
}
