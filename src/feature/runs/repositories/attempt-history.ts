import type { Database, Row } from '../../../platform/sqlite/index.ts';
import type {
  AttemptHistoryItem,
  AttemptHistoryPage,
  AttemptHistoryQuery,
  AttemptHistoryResult,
} from '../types/index.ts';
import { attemptHistoryId, attemptHistoryResult, attemptHistoryTitle } from '../types/index.ts';

export class AttemptHistoryRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  page(query: AttemptHistoryQuery): AttemptHistoryPage {
    const conditions = ['a.group_slug = ?'];
    const values: (string | number)[] = [query.group];
    if (query.repository !== undefined)
      add(conditions, values, 'r.repository = ?', query.repository);
    if (query.runtime !== undefined) add(conditions, values, 'a.runtime = ?', query.runtime);
    if (query.model !== undefined) add(conditions, values, 'a.model = ?', query.model);
    if (query.from !== undefined) add(conditions, values, 'a.started_at >= ?', query.from);
    if (query.to !== undefined) add(conditions, values, 'a.started_at < ?', query.to);
    if (query.result !== undefined) {
      resultCondition(conditions, values, query.result);
    }
    if (query.cursor) {
      conditions.push('(a.started_at, a.run_id, a.seq) < (?, ?, ?)');
      values.push(query.cursor.startedAt, query.cursor.runId, query.cursor.seq);
    }
    const projects = (
      this.database
        .prepare(
          'SELECT DISTINCT repository FROM runs WHERE id IN (SELECT run_id FROM attempts WHERE group_slug = ?) ORDER BY repository',
        )
        .all(query.group) as Row[]
    ).map((row) => String(row.repository));
    const rows = this.database
      .prepare(
        `
      SELECT a.run_id, a.seq, a.runtime, a.model, a.status, a.report_json,
             a.reason_json, a.started_at, a.finished_at, a.usage_json,
             r.repository, r.number, r.title, r.name
      FROM attempts a JOIN runs r ON r.id = a.run_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.started_at DESC, a.run_id DESC, a.seq DESC
      LIMIT ?
    `,
      )
      .all(...values, query.limit + 1) as Row[];
    const more = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map(mapItem);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        more && last
          ? { startedAt: last.startedAt, runId: last.runId, seq: last.attemptSeq }
          : null,
      projects,
    };
  }
}

function add(
  conditions: string[],
  values: (string | number)[],
  sql: string,
  value: string | number,
): void {
  conditions.push(sql);
  values.push(value);
}

function resultCondition(
  conditions: string[],
  values: (string | number)[],
  result: AttemptHistoryResult,
): void {
  if (result === 'running') {
    conditions.push("a.status = 'running'");
  } else if (result === 'failed') {
    conditions.push("a.status = 'failed'");
  } else if (result === 'cancelled') {
    conditions.push("a.status = 'cancelled'");
  } else if (result === 'unknown') {
    conditions.push(
      "a.status = 'finished' AND (a.report_json IS NULL OR json_extract(a.report_json, '$.verdict') IS NULL OR json_extract(a.report_json, '$.verdict') NOT IN ('done', 'rejected', 'needs_human'))",
    );
  } else {
    conditions.push("a.status = 'finished' AND json_extract(a.report_json, '$.verdict') = ?");
    values.push(result);
  }
}

function mapItem(row: Row): AttemptHistoryItem {
  const report = parseObject(row.report_json);
  const reason = parseObject(row.reason_json);
  const status = String(row.status) as AttemptHistoryItem['status'];
  const verdict = ['done', 'rejected', 'needs_human'].includes(String(report?.verdict))
    ? (report?.verdict as AttemptHistoryItem['verdict'])
    : null;
  return {
    id: attemptHistoryId(String(row.run_id), Number(row.seq)),
    runId: String(row.run_id),
    runNumber: Number(row.number),
    runTitle: attemptHistoryTitle(
      stringOrNull(row.title),
      stringOrNull(row.name),
      String(row.run_id),
    ),
    repository: String(row.repository),
    attemptSeq: Number(row.seq),
    runtime: String(row.runtime) as AttemptHistoryItem['runtime'],
    model: stringOrNull(row.model),
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    status,
    verdict,
    result: attemptHistoryResult(status, verdict),
    failureKind: typeof reason?.kind === 'string' ? reason.kind : null,
    usage: parseObject(row.usage_json) as AttemptHistoryItem['usage'],
  };
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
