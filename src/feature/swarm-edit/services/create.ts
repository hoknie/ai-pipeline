import type { AgentsService } from '../../agents/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { ConfigChangedPort } from '../ports/index.ts';

import { ConfigEditService } from './config-edits.ts';
import { SharedConfigService } from './shared-config.ts';

export interface SwarmEditServices {
  edits: ConfigEditService;
  shared: SharedConfigService;
}

export function createSwarmEditServices(dependencies: {
  config: ConfigService;
  registry: RegistryService;
  agents: AgentsService;
  changed: ConfigChangedPort;
}): SwarmEditServices {
  const shared = new SharedConfigService(dependencies);
  return { edits: new ConfigEditService({ ...dependencies, shared }), shared };
}
