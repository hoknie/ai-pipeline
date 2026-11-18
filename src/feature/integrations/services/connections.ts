import { randomBytes } from 'node:crypto';

import type { RegistryService } from '../../repos/services/index.ts';
import type { ConnectionRepository, SecretRepository } from '../repositories/index.ts';
import {
  refusal,
  secretSpec,
  validateName,
  validateParams,
  validateSecretValue,
  type CatalogEntry,
  type Connection,
  type ConnectionView,
  type SecretStatus,
} from '../types/index.ts';

import type { ConnectionAccess } from './access.ts';
import type { AdapterCatalog } from './catalog.ts';
import type { SecretService } from './secrets.ts';

export interface ConnectionDependencies {
  connections: ConnectionRepository;
  secrets: SecretRepository;
  catalog: AdapterCatalog;
  registry: RegistryService;
  secretService: SecretService;
  access: ConnectionAccess;
  now: () => number;
}

export interface NewConnection {
  kind: string;
  name: string;
  /** A project reference (path or slug); absent with `global`. */
  repository?: string | undefined;
  /** The explicit choice of the shared scope; the project is never guessed. */
  global?: boolean | undefined;
  params?: Record<string, string> | undefined;
}

/**
 * The registry of connections: named, per project or shared, with the parameters of a built-in
 * kind and the presence of its secrets. Values never pass through here except into the store.
 */
export class ConnectionService {
  private readonly dependencies: ConnectionDependencies;

  constructor(dependencies: ConnectionDependencies) {
    this.dependencies = dependencies;
  }

  types(): CatalogEntry[] {
    return this.dependencies.catalog.entries();
  }

  /** Every connection, or those of a project and the shared ones. */
  async list(repository?: string): Promise<ConnectionView[]> {
    const { connections, registry } = this.dependencies;
    const root = repository === undefined ? undefined : await this.projectOf(registry, repository);
    return connections
      .all()
      .filter((one) => root === undefined || one.scope === 'global' || one.projectPath === root)
      .map((one) => this.view(one));
  }

  async add(request: NewConnection): Promise<ConnectionView> {
    const { connections, catalog, registry, now } = this.dependencies;
    const descriptor = catalog.adapter(request.kind).descriptor;
    validateName(request.name);
    const params = validateParams(descriptor, request.params ?? {});
    if ((request.global === true) === (request.repository !== undefined)) {
      throw refusal('scope_required');
    }
    const projectPath =
      request.global === true ? null : await this.projectOf(registry, request.repository);
    const connection: Connection = {
      id: `c${randomBytes(6).toString('hex')}`,
      kind: request.kind,
      name: request.name,
      scope: projectPath === null ? 'global' : 'project',
      projectPath,
      params,
      enabled: false,
      state: 'ready',
      createdAt: now(),
      updatedAt: now(),
    };
    try {
      connections.insert(connection);
    } catch {
      throw refusal('name_taken');
    }
    return this.view(connection);
  }

  /** Enables a connection that has every required secret and a usable backend. */
  async enable(id: string): Promise<ConnectionView> {
    const { connections, catalog, secretService, now } = this.dependencies;
    return secretService.serialized(id, async () => {
      const verify = (): void => {
        const connection = this.dependencies.access.find(id);
        if (secretService.pending(connection)) throw refusal('operation_pending');
        if (!catalog.has(connection.kind)) throw refusal('unknown_kind');
        for (const spec of catalog.adapter(connection.kind).descriptor.secrets) {
          if (spec.required && !secretService.has(id, spec.slot)) {
            throw refusal('missing_secret', spec.slot);
          }
        }
      };
      verify();
      await secretService.check();
      // The state may have changed while the backend was checked.
      verify();
      connections.setEnabled(id, true, now());
      return this.view(this.dependencies.access.find(id));
    });
  }

  disable(id: string): ConnectionView {
    this.dependencies.access.find(id);
    this.dependencies.connections.setEnabled(id, false, this.dependencies.now());
    return this.view(this.dependencies.access.find(id));
  }

  /** Removes the connection and its secrets; a failed cleanup leaves it without authority until repeated. */
  async remove(id: string): Promise<void> {
    await this.dependencies.secretService.removeConnection(id);
  }

  async setSecret(id: string, slot: string, value: string): Promise<ConnectionView> {
    const connection = this.dependencies.access.find(id);
    validateSecretValue(value);
    secretSpec(this.dependencies.catalog.adapter(connection.kind).descriptor, slot);
    await this.dependencies.secretService.set(id, slot, value);
    return this.view(this.dependencies.access.find(id));
  }

  async removeSecret(id: string, slot: string): Promise<ConnectionView> {
    const connection = this.dependencies.access.find(id);
    secretSpec(this.dependencies.catalog.adapter(connection.kind).descriptor, slot);
    await this.dependencies.secretService.remove(id, slot);
    return this.view(this.dependencies.access.find(id));
  }

  /** One statement: part of the transaction that moves a project; ids and secrets stay. */
  moveProject(from: string, to: string): void {
    this.dependencies.connections.moveProject(from, to);
  }

  /** Refuses to forget a project that still has connections: their secrets would be orphaned. */
  assertNoConnections(root: string): void {
    if (this.dependencies.connections.countOfProject(root) > 0) {
      throw refusal('project_has_connections');
    }
  }

  view(connection: Connection): ConnectionView {
    const { catalog, secrets, secretService } = this.dependencies;
    const declared: SecretStatus[] = catalog.has(connection.kind)
      ? catalog.adapter(connection.kind).descriptor.secrets.map((spec) => ({
          slot: spec.slot,
          required: spec.required,
          present: secretService.has(connection.id, spec.slot),
        }))
      : secrets.slots(connection.id).map(({ slot }) => ({ slot, required: false, present: true }));
    return {
      id: connection.id,
      kind: connection.kind,
      name: connection.name,
      scope: connection.scope,
      project: connection.projectPath,
      params: connection.params,
      enabled: connection.enabled,
      state: connection.state,
      secrets: declared,
      pending: secretService.pending(connection),
    };
  }

  private async projectOf(
    registry: RegistryService,
    reference: string | undefined,
  ): Promise<string> {
    try {
      return await registry.resolve(reference ?? '');
    } catch {
      throw refusal('unknown_project');
    }
  }
}
