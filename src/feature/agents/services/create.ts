import { AgentsService, type AgentsDependencies } from './agents.ts';

/** The services of the feature `agents`. */
export interface AgentsServices {
  agents: AgentsService;
}

export function createAgentsServices(dependencies: AgentsDependencies): AgentsServices {
  return { agents: new AgentsService(dependencies) };
}
