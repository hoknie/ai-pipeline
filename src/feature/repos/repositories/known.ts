import type { Database } from '../../../platform/sqlite/index.ts';
import type { KnownRepository, ProjectColor } from '../types/index.ts';

interface Row {
  path: string;
  added_at: number;
  name: string | null;
  slug: string | null;
  enabled: number;
  color: string | null;
}

const fromRow = (row: Row): KnownRepository => ({
  path: row.path,
  addedAt: row.added_at,
  name: row.name,
  slug: row.slug,
  enabled: row.enabled !== 0,
  color: row.color as ProjectColor | null,
});

export class KnownRepositories {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  repositories(): KnownRepository[] {
    const rows = this.database
      .prepare('SELECT path, added_at, name, slug, enabled, color FROM repositories ORDER BY path')
      .all() as unknown as Row[];
    return rows.map(fromRow);
  }

  /** Returns true when the repository was not in the registry yet. */
  addRepository(
    path: string,
    now: number,
    attributes: Partial<Pick<KnownRepository, 'name' | 'slug' | 'color'>> = {},
  ): boolean {
    const result = this.database
      .prepare(
        'INSERT OR IGNORE INTO repositories (path, added_at, name, slug, color) VALUES (?, ?, ?, ?, ?)',
      )
      .run(path, now, attributes.name ?? null, attributes.slug ?? null, attributes.color ?? null);
    return Number(result.changes) > 0;
  }

  /** Writes the attributes of a project; the path and the time it was added stay. */
  updateRepository(project: KnownRepository): void {
    this.database
      .prepare('UPDATE repositories SET name = ?, slug = ?, enabled = ?, color = ? WHERE path = ?')
      .run(project.name, project.slug, project.enabled ? 1 : 0, project.color, project.path);
  }

  /** Gives a project another path, keeping its attributes. */
  moveRepository(from: string, to: string): void {
    this.database.prepare('UPDATE repositories SET path = ? WHERE path = ?').run(to, from);
  }

  removeRepository(path: string): void {
    this.database.prepare('DELETE FROM repositories WHERE path = ?').run(path);
  }
}
