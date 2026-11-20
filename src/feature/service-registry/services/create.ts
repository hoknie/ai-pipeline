import type { IntegrationsServices } from '../../integrations/services/index.ts';

import type { RegistryTransportPort } from '../ports/index.ts';

import { serviceRegistryAdapter } from './adapter.ts';
import { Forwarder } from './forwarder.ts';

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
}

export interface ServiceRegistryServices {
  /** The adapter the composition root registers in the catalog of integrations. */
  adapter: ReturnType<typeof serviceRegistryAdapter>;
  /** Carries the messages of the bridges of the attempts to the registries. */
  forwarder: Forwarder;
}

/** The feature: its pieces over the proxy rule of the daemon, which the composition root supplies. */
export function createServiceRegistryServices(
  dependencies: ServiceRegistryDependencies,
): ServiceRegistryServices {
  return {
    adapter: serviceRegistryAdapter(dependencies),
    forwarder: new Forwarder(dependencies),
  };
}
