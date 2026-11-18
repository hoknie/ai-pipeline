import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { databasePath, ensureDirectory } from '../../../src/platform/paths/index.ts';
import { Database } from '../../../src/platform/sqlite/index.ts';
import type {
  IntegrationAdapterPort,
  IntegrationOperationsPort,
  SecretStorePort,
} from '../../../src/feature/integrations/ports/index.ts';
import {
  createIntegrationsServices,
  type IntegrationsDependencies,
  type IntegrationsServices,
} from '../../../src/feature/integrations/services/index.ts';
import type {
  AdapterDescriptor,
  InboundOperation,
  OperationResult,
} from '../../../src/feature/integrations/types/index.ts';
import { createReposServices } from '../../../src/feature/repos/services/index.ts';

/** A value no response, log or table may ever contain. */
export const SENTINEL = 'sentinel-secret-5f1c9e';

/** A secret store in memory that can be made to fail, call by call or all at once. */
export class MemoryStore implements SecretStorePort {
  readonly values = new Map<string, string>();
  down = false;
  /** Fails the next calls of these methods once each. */
  failNext = new Set<'get' | 'put' | 'delete'>();
  readonly calls: string[] = [];

  private guard(method: 'get' | 'put' | 'delete'): void {
    this.calls.push(method);
    if (this.down || this.failNext.delete(method)) throw new Error(`down ${SENTINEL}`);
  }

  check(): Promise<void> {
    if (this.down) return Promise.reject(new Error(`down ${SENTINEL}`));
    return Promise.resolve();
  }

  get(key: string): Promise<string | null> {
    try {
      this.guard('get');
      return Promise.resolve(this.values.get(key) ?? null);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  put(key: string, value: string): Promise<void> {
    try {
      this.guard('put');
      this.values.set(key, value);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  delete(key: string): Promise<void> {
    try {
      this.guard('delete');
      this.values.delete(key);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

export const EXAMPLE: AdapterDescriptor = {
  kind: 'example',
  title: 'Example',
  params: [
    { name: 'account', required: false, maxLength: 40 },
    { name: 'region', required: false, maxLength: 10, values: ['eu', 'us'] },
  ],
  secrets: [
    { slot: 'token', required: true },
    { slot: 'signing', required: false },
  ],
  directions: ['inbound', 'outbound'],
  operations: ['queue_task', 'cancel_run'],
};

export function exampleAdapter(
  extra: Partial<IntegrationAdapterPort> = {},
): IntegrationAdapterPort {
  return { descriptor: EXAMPLE, ...extra };
}

export interface Fixture {
  database: Database;
  store: MemoryStore;
  services: IntegrationsServices;
  registry: ReturnType<typeof createReposServices>['registry'];
  performed: { project: string; operation: InboundOperation }[];
  /** Builds the services again over the same database and store, as a restart does. */
  restart(overrides?: Partial<IntegrationsDependencies>): IntegrationsServices;
}

/** The services of the integrations over a temporary database, with two registered projects. */
export function fixture(
  options: {
    adapters?: readonly IntegrationAdapterPort[];
    store?: MemoryStore;
    now?: () => number;
    operations?: (project: string, operation: InboundOperation) => Promise<OperationResult>;
    overrides?: Partial<IntegrationsDependencies>;
  } = {},
): Fixture {
  const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-integrations-')), 'aip'));
  const database = new Database(databasePath(directory));
  const store = options.store ?? new MemoryStore();
  const now = options.now ?? (() => 1000);
  const { registry } = createReposServices({
    database,
    now,
    publish: { repositoriesChanged: () => undefined },
  });
  registry.remember('/work/app', { slug: 'app' });
  registry.remember('/work/lib', { slug: 'lib' });
  const performed: Fixture['performed'] = [];
  const operations: IntegrationOperationsPort = {
    perform: (project, operation) => {
      performed.push({ project, operation });
      return (options.operations ?? (() => Promise.resolve({ queued: true })))(project, operation);
    },
  };
  const build = (overrides: Partial<IntegrationsDependencies> = {}): IntegrationsServices =>
    createIntegrationsServices({
      database,
      registry,
      store,
      installation: () => 'inst1',
      adapters: options.adapters ?? [exampleAdapter()],
      operations,
      now,
      ...options.overrides,
      ...overrides,
    });
  return { database, store, services: build(), registry, performed, restart: build };
}
