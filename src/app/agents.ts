import { createClaudeRuntime } from '../feature/agents/clients/claude/index.ts';
import { NamingClient } from '../feature/agents/clients/naming/index.ts';
import { createOpencodeRuntime } from '../feature/agents/clients/opencode/index.ts';
import { createAgentsServices, type AgentsServices } from '../feature/agents/services/index.ts';

/** The services of `agents` with the adapters of both agent CLIs. */
export function createAgents(environment: NodeJS.ProcessEnv): AgentsServices {
  return createAgentsServices({
    environment,
    factories: { claude: createClaudeRuntime, opencode: createOpencodeRuntime },
    naming: new NamingClient(),
  });
}
