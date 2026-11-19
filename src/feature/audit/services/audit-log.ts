import { clipText, type AuditEvent, type AuditQuery, type NewAuditEvent } from '../types/index.ts';
import type { AuditEventsRepository } from '../repositories/index.ts';

export interface AuditLogDependencies {
  events: AuditEventsRepository;
}

/** The journal of the actions of the server mode: entries are added, read and, when old, deleted. */
export class AuditLog {
  private readonly dependencies: AuditLogDependencies;

  constructor(dependencies: AuditLogDependencies) {
    this.dependencies = dependencies;
  }

  /** Adds an entry; the text of an error is cut to a fixed length. */
  record(event: NewAuditEvent): void {
    this.dependencies.events.insert({
      ...event,
      error: event.error === null ? null : clipText(event.error),
    });
  }

  /** The entries the query selects, the newest first. */
  list(query: AuditQuery): AuditEvent[] {
    return this.dependencies.events.list(query);
  }

  /** Deletes the entries older than `before` (ms); returns how many. */
  prune(before: number): number {
    return this.dependencies.events.prune(before);
  }
}
