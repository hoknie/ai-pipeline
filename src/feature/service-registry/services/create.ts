import { join } from 'node:path';

import type { Database } from '../../../platform/sqlite/index.ts';
import type { IntegrationsServices } from '../../integrations/services/index.ts';
import type { ProjectService, RegistryService } from '../../repos/services/index.ts';

import type { RegistryTransportPort } from '../ports/index.ts';
import { LinkRepository } from '../repositories/index.ts';

import { serviceRegistryAdapter } from './adapter.ts';
import { RegistryCalls } from './calls.ts';
import { Forwarder } from './forwarder.ts';
import { RegistryLinks } from './links.ts';
import { SkillService } from './skills.ts';

export interface ServiceRegistryDependencies {
  /** The HTTP client of the registries; the composition root brings it from `clients`. */
  transport: RegistryTransportPort;
  /** The proxy for a request to `url`: the settings and the environment of the daemon. */
  proxyFor: (url: string) => string | null;
  /**
   * The integrations the registry connections live in. Called when a request needs them, not when
   * the feature is built: the adapter is registered in the catalog of the integrations first.
   */
  integrations: () => Pick<IntegrationsServices, 'access' | 'secrets'>;
  /** The state directory of the daemon; the skills are cached under `service-registry/skills`. */
  stateDirectory: string;
  database: Database;
  /** The projects of aip: the roots and the `origin` of each. */
  repositories: Pick<RegistryService, 'entries'>;
  projects: Pick<ProjectService, 'originOf'>;
  now: () => number;
}

export interface ServiceRegistryServices {
  /** The adapter the composition root registers in the catalog of integrations. */
  adapter: ReturnType<typeof serviceRegistryAdapter>;
  /** Carries the messages of the bridges of the attempts to the registries. */
  forwarder: Forwarder;
  /** The skills of the registries: selection, cache, the copy for an attempt. */
  skills: SkillService;
  /** The links of the projects of aip to the projects of the registries. */
  links: RegistryLinks;
}

/** The feature: its pieces over the proxy rule of the daemon, which the composition root supplies. */
export function createServiceRegistryServices(
  dependencies: ServiceRegistryDependencies,
): ServiceRegistryServices {
  return {
    adapter: serviceRegistryAdapter(dependencies),
    forwarder: new Forwarder(dependencies),
    skills: new SkillService({
      transport: dependencies.transport,
      proxyFor: dependencies.proxyFor,
      integrations: dependencies.integrations,
      cacheDirectory: join(dependencies.stateDirectory, 'service-registry', 'skills'),
      now: dependencies.now,
    }),
    links: new RegistryLinks({
      links: new LinkRepository(dependencies.database),
      origins: dependencies.projects,
      repositories: dependencies.repositories,
      integrations: dependencies.integrations,
      calls: new RegistryCalls(dependencies),
      now: dependencies.now,
    }),
  };
}
