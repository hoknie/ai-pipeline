import type { Database } from '../../../platform/sqlite/index.ts';
import type { LinkSource, LinkStatus, ProjectLink } from '../types/index.ts';

interface Row {
  project_path: string;
  connection_id: string;
  registry_path: string | null;
  source: string | null;
  status: string;
  candidates_json: string;
  matched_at: number;
}

const toLink = (row: Row): ProjectLink => ({
  project: row.project_path,
  connectionId: row.connection_id,
  registryPath: row.registry_path,
  source: row.source as LinkSource | null,
  status: row.status as LinkStatus,
  candidates: JSON.parse(row.candidates_json) as string[],
  matchedAt: row.matched_at,
});

/** The table `service_registry_links`; every method is one statement. */
export class LinkRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  find(project: string, connectionId: string): ProjectLink | undefined {
    const row = this.database
      .prepare('SELECT * FROM service_registry_links WHERE project_path = ? AND connection_id = ?')
      .get(project, connectionId) as Row | undefined;
    return row === undefined ? undefined : toLink(row);
  }

  /** Every row of a project, or every row. */
  all(project?: string): ProjectLink[] {
    const rows = (project === undefined
      ? this.database
          .prepare('SELECT * FROM service_registry_links ORDER BY project_path, connection_id')
          .all()
      : this.database
          .prepare(
            'SELECT * FROM service_registry_links WHERE project_path = ? ORDER BY connection_id',
          )
          .all(project)) as unknown as Row[];
    return rows.map(toLink);
  }

  /** Writes the row of the pair, replacing the old one. */
  put(link: ProjectLink): void {
    this.database
      .prepare(
        `INSERT INTO service_registry_links
           (project_path, connection_id, registry_path, source, status, candidates_json, matched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (project_path, connection_id) DO UPDATE SET
           registry_path = excluded.registry_path, source = excluded.source,
           status = excluded.status, candidates_json = excluded.candidates_json,
           matched_at = excluded.matched_at`,
      )
      .run(
        link.project,
        link.connectionId,
        link.registryPath,
        link.source,
        link.status,
        JSON.stringify(link.candidates),
        link.matchedAt,
      );
  }

  remove(project: string, connectionId: string): void {
    this.database
      .prepare('DELETE FROM service_registry_links WHERE project_path = ? AND connection_id = ?')
      .run(project, connectionId);
  }

  /** A project that left aip has no links to keep. */
  forgetProject(project: string): void {
    this.database.prepare('DELETE FROM service_registry_links WHERE project_path = ?').run(project);
  }

  /** The links of a project that moved follow it. */
  moveProject(from: string, to: string): void {
    this.database
      .prepare('UPDATE service_registry_links SET project_path = ? WHERE project_path = ?')
      .run(to, from);
  }
}
