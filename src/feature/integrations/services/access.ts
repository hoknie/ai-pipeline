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

  /** Whether every required secret of the connection is set. */
  complete(connection: Connection): boolean {
    const { catalog, secrets } = this.dependencies;
    if (!catalog.has(connection.kind)) return false;
    return catalog
      .adapter(connection.kind)
      .descriptor.secrets.every((spec) => !spec.required || secrets.has(connection.id, spec.slot));
  }
}
