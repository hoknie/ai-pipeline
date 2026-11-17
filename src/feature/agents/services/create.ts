import { AgentsService, type AgentsDependencies } from './agents.ts';
import { ProvidersService } from './providers.ts';

/** The services of the feature `agents`. */
export interface AgentsServices {
  agents: AgentsService;
  providers: ProvidersService;
}

export function createAgentsServices(dependencies: AgentsDependencies): AgentsServices {
  const agents = new AgentsService(dependencies);
  return { agents, providers: new ProvidersService(agents) };
}
