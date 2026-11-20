import type { Database } from '../../../platform/sqlite/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type {
  IntegrationAdapterPort,
  IntegrationChangesPort,
  IntegrationOperationsPort,
  SecretStorePort,
} from '../ports/index.ts';
import {
  ConnectionRepository,
  DeliveryRepository,
  SecretRepository,
} from '../repositories/index.ts';
import type { InboundLimits } from '../types/index.ts';

import { ConnectionAccess } from './access.ts';
import { AdapterCatalog } from './catalog.ts';
import { ConnectionService } from './connections.ts';
import { InboundService } from './dispatch.ts';
import { OutboundService } from './outbound.ts';
import { SecretService, type SecretStep } from './secrets.ts';

export interface IntegrationsServices {
  catalog: AdapterCatalog;
  connections: ConnectionService;
  access: ConnectionAccess;
  secrets: SecretService;
  inbound: InboundService;
  outbound: OutboundService;
}

export interface IntegrationsDependencies {
  database: Database;
  registry: RegistryService;
  store: SecretStorePort;
  /** Read when a key of the store is first built, so an idle daemon writes nothing. */
  installation: () => string;
  /** The built-in adapters of this build; none in the first version. */
  adapters: readonly IntegrationAdapterPort[];
  operations: IntegrationOperationsPort;
  /** Told when a connection changes; absent: nobody listens. */
  changes?: IntegrationChangesPort;
  now: () => number;
  limits?: Partial<InboundLimits>;
  outboundTimeoutMs?: number;
  /** A seam of the tests: called after every step of a secret operation. */
  secretStep?: (step: SecretStep) => void;
  newGeneration?: () => string;
}

export function createIntegrationsServices(
  dependencies: IntegrationsDependencies,
): IntegrationsServices {
  const { database, registry, store, installation, now } = dependencies;
  const connections = new ConnectionRepository(database);
  const secretRows = new SecretRepository(database);
  const deliveries = new DeliveryRepository(database);
  const catalog = new AdapterCatalog(dependencies.adapters);
  const secrets = new SecretService({
    database,
    connections,
    secrets: secretRows,
    deliveries,
    store,
    installation,
    now,
    ...(dependencies.newGeneration ? { newGeneration: dependencies.newGeneration } : {}),
    ...(dependencies.secretStep ? { step: dependencies.secretStep } : {}),
  });
  const access = new ConnectionAccess({ connections, catalog, secrets });
  const service = new ConnectionService({
    connections,
    secrets: secretRows,
    catalog,
    changes: dependencies.changes ?? { connectionChanged: () => undefined },
    registry,
    secretService: secrets,
    access,
    now,
  });
  return {
    catalog,
    connections: service,
    access,
    secrets,
    inbound: new InboundService({
      catalog,
      access,
      secrets,
      deliveries,
      registry,
      operations: dependencies.operations,
      now,
      ...(dependencies.limits ? { limits: dependencies.limits } : {}),
    }),
    outbound: new OutboundService({
      catalog,
      access,
      secrets,
      timeoutMs: dependencies.outboundTimeoutMs ?? 15_000,
    }),
  };
}
