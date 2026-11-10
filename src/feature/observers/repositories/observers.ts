import type { Database, Row } from '../../../platform/sqlite/index.ts';
import { type ObserverSettings, defaultObserverSettings } from '../types/index.ts';

export class ObserverRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Settings of the observers; the defaults until they are saved. */
  loadObservers(): ObserverSettings {
    const row = this.database.prepare('SELECT settings_json FROM observers WHERE id = 1').get() as
      Row | undefined;
    const defaults = defaultObserverSettings();
    if (!row) return defaults;
    try {
      const saved = JSON.parse(String(row.settings_json)) as Partial<ObserverSettings>;
      return {
        enabled: saved.enabled ?? defaults.enabled,
        workers: saved.workers ?? defaults.workers,
        maxRepairs: saved.maxRepairs ?? defaults.maxRepairs,
        projects: saved.projects ?? defaults.projects,
        specialist: saved.specialist ?? defaults.specialist,
      };
    } catch {
      return defaults;
    }
  }

  saveObservers(settings: ObserverSettings): void {
    this.database
      .prepare(
        `INSERT INTO observers (id, settings_json, updated_at) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(settings), Date.now());
  }
}
