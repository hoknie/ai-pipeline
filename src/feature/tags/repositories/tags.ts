import type { Database } from '../../../platform/sqlite/index.ts';
import type { Tag, TagColor } from '../types/index.ts';

export class TagRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  tags(): Tag[] {
    const rows = this.database
      .prepare(
        'SELECT id, repository, name, color, created_at, task_run, task_number FROM tags ORDER BY created_at, id',
      )
      .all() as {
      id: string;
      repository: string;
      name: string;
      color: string;
      created_at: number;
      task_run: string | null;
      task_number: number | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      repository: row.repository,
      name: row.name,
      color: row.color as TagColor,
      createdAt: row.created_at,
      task:
        row.task_run !== null && row.task_number !== null
          ? { run: row.task_run, number: row.task_number }
          : null,
    }));
  }

  saveTag(tag: Tag): void {
    this.database
      .prepare(
        `INSERT INTO tags (id, repository, name, color, created_at, task_run, task_number) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color`,
      )
      .run(
        tag.id,
        tag.repository,
        tag.name,
        tag.color,
        tag.createdAt,
        tag.task?.run ?? null,
        tag.task?.number ?? null,
      );
  }

  /** One statement, no transaction of its own: the tags of a project that moved. */
  moveTags(from: string, to: string): void {
    this.database.prepare('UPDATE tags SET repository = ? WHERE repository = ?').run(to, from);
  }

  /** One statement, no transaction of its own: the scenario of removing a tag opens it. */
  deleteTag(repository: string, id: string): void {
    this.database.prepare('DELETE FROM tags WHERE id = ? AND repository = ?').run(id, repository);
  }
}
