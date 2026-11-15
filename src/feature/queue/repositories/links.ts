import type { Database, Row } from '../../../platform/sqlite/index.ts';
import { type LinkKind, type TaskLink, isLinkKind } from '../types/index.ts';

/** The table `task_links`: SQL only. No transaction of its own: a scenario that writes several opens it. */
export class TaskLinksRepository {
  private readonly database: Database;
  /** Grows with every change: a reader of the whole table knows when its copy is stale. */
  private changes = 0;

  constructor(database: Database) {
    this.database = database;
  }

  get version(): number {
    return this.changes;
  }

  /** Every link, the links of a source in the order they were added. */
  all(): TaskLink[] {
    const rows = this.database
      .prepare('SELECT source, kind, target FROM task_links ORDER BY source, position, rowid')
      .all() as Row[];
    return rows.flatMap((row) =>
      isLinkKind(String(row.kind))
        ? [
            {
              source: String(row.source),
              kind: String(row.kind) as LinkKind,
              target: String(row.target),
            },
          ]
        : [],
    );
  }

  /** The targets of the links of `source` of the kinds, in order. */
  targets(source: string, kinds: readonly LinkKind[]): string[] {
    const rows = this.database
      .prepare('SELECT kind, target FROM task_links WHERE source = ? ORDER BY position, rowid')
      .all(source) as Row[];
    return rows
      .filter((row) => kinds.includes(String(row.kind) as LinkKind))
      .map((row) => String(row.target));
  }

  /** The `blocked_by` targets of the items of a repository, by item, in order. */
  blockedBy(repository: string): Map<string, string[]> {
    const rows = this.database
      .prepare(
        `SELECT source, target FROM task_links
         WHERE kind = 'blocked_by' AND source IN (SELECT id FROM queue_items WHERE repository = ?)
         ORDER BY position, rowid`,
      )
      .all(repository) as Row[];
    const found = new Map<string, string[]>();
    for (const row of rows) {
      const list = found.get(String(row.source)) ?? [];
      list.push(String(row.target));
      found.set(String(row.source), list);
    }
    return found;
  }

  /** The links of `source` of the `kinds` become `links` (kind and target), in this order. */
  replaceSource(
    source: string,
    kinds: readonly LinkKind[],
    links: readonly Pick<TaskLink, 'kind' | 'target'>[],
    now = 0,
  ): void {
    const current = this.rowsOf(source).filter((row) => kinds.includes(row.kind));
    const same =
      current.length === links.length &&
      current.every(
        (row, index) => row.kind === links[index]?.kind && row.target === links[index]?.target,
      );
    if (same) return;
    const kept = this.rowsOf(source).filter((row) => !kinds.includes(row.kind));
    let position = kept.reduce((top, row) => Math.max(top, row.position + 1), 0);
    this.database
      .prepare(
        `DELETE FROM task_links WHERE source = ? AND kind IN (${kinds.map(() => '?').join(', ')})`,
      )
      .run(source, ...kinds);
    for (const link of links) {
      this.insert({ source, ...link }, position, now);
      position += 1;
    }
    this.changes += 1;
  }

  /** Adds a link after the others of its source; an existing one stays where it is. */
  add(link: TaskLink, now: number): void {
    const top = this.database
      .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM task_links WHERE source = ?')
      .get(link.source) as { next: number };
    this.insert(link, Number(top.next), now);
    this.changes += 1;
  }

  remove(link: TaskLink): void {
    this.database
      .prepare('DELETE FROM task_links WHERE source = ? AND kind = ? AND target = ?')
      .run(link.source, link.kind, link.target);
    this.changes += 1;
  }

  /** Every link that starts or ends at `from` starts or ends at `to`; repeats and self-links are dropped. */
  moveRef(from: string, to: string): void {
    this.database
      .prepare('UPDATE OR IGNORE task_links SET source = ? WHERE source = ?')
      .run(to, from);
    this.database
      .prepare('UPDATE OR IGNORE task_links SET target = ? WHERE target = ?')
      .run(to, from);
    this.database.prepare('DELETE FROM task_links WHERE source = ? OR target = ?').run(from, from);
    this.database.prepare('DELETE FROM task_links WHERE source = target').run();
    this.changes += 1;
  }

  /** Every link that starts or ends at `id` is deleted. */
  removeRef(id: string): void {
    this.database.prepare('DELETE FROM task_links WHERE source = ? OR target = ?').run(id, id);
    this.changes += 1;
  }

  private rowsOf(source: string): { kind: LinkKind; target: string; position: number }[] {
    const rows = this.database
      .prepare(
        'SELECT kind, target, position FROM task_links WHERE source = ? ORDER BY position, rowid',
      )
      .all(source) as Row[];
    return rows.map((row) => ({
      kind: String(row.kind) as LinkKind,
      target: String(row.target),
      position: Number(row.position),
    }));
  }

  private insert(link: TaskLink, position: number, now: number): void {
    this.database
      .prepare(
        'INSERT OR IGNORE INTO task_links (source, kind, target, position, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(link.source, link.kind, link.target, position, now);
  }
}
