import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { NetworkChangedPort } from '../ports/index.ts';
import { NetworkMonitor, type NetworkProbes } from './monitor.ts';

export interface NetworkServices {
  monitor: NetworkMonitor;
}

export function createNetworkServices(dependencies: {
  config: ConfigService;
  now: () => number;
  changed: NetworkChangedPort;
  probes?: NetworkProbes;
  environment?: NodeJS.ProcessEnv;
}): NetworkServices {
  return { monitor: new NetworkMonitor(dependencies) };
}
