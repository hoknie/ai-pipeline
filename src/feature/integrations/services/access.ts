import type { ConnectionRepository } from '../repositories/index.ts';
import { connectionServes, refusal, type Connection } from '../types/index.ts';

import type { AdapterCatalog } from './catalog.ts';
import type { SecretService } from './secrets.ts';

export interface AccessDependencies {
  connections: ConnectionRepository;
  catalog: AdapterCatalog;
  secrets: SecretService;
}

/** The authority of a connection: whether it may act now, and for which project. */
export class ConnectionAccess {
  private readonly dependencies: AccessDependencies;

  constructor(dependencies: AccessDependencies) {
    this.dependencies = dependencies;
  }

  find(id: string): Connection {
    const connection = this.dependencies.connections.find(id);
    if (connection === undefined) throw refusal('not_found');
    return connection;
  }

  /**
   * The connection an operation on `project` may use: it must exist, be ready and enabled, have
   * nothing pending and serve that project. No secret is read before this passes.
   */
  authorize(id: string, project: string): Connection {
    const connection = this.find(id);
    if (!connection.enabled || connection.state !== 'ready') throw refusal('disabled');
    if (this.dependencies.secrets.pending(connection)) throw refusal('disabled');
    if (!connectionServes(connection, project)) throw refusal('scope_denied');
    return connection;
  }

  /**
   * The ready connection of a kind and name that serves the project: its own first, then the
   * shared one. Whether it is enabled is for the caller to ask.
   */
  named(kind: string, name: string, project: string): Connection | undefined {
    const found = this.dependencies.connections
      .all()
      .filter((one) => one.kind === kind && one.name === name && one.state === 'ready');
    return (
      found.find((one) => one.scope === 'project' && one.projectPath === project) ??
      found.find((one) => one.scope === 'global')
    );
  }

  /**
   * The connections of a kind that may act for the project now: ready, enabled, with every secret
   * set and nothing pending, its own and the shared ones.
   */
  serving(kind: string, project: string): Connection[] {
    return this.dependencies.connections
      .all()
      .filter(
        (one) =>
          one.kind === kind &&
          one.state === 'ready' &&
          one.enabled &&
          connectionServes(one, project) &&
          !this.dependencies.secrets.pending(one) &&
          this.complete(one),
      );
  }

  /** Whether every required secret of the connection is set. */
  complete(connection: Connection): boolean {
    const { catalog, secrets } = this.dependencies;
    if (!catalog.has(connection.kind)) return false;
    return catalog
      .adapter(connection.kind)
      .descriptor.secrets.every((spec) => !spec.required || secrets.has(connection.id, spec.slot));
  }
}
