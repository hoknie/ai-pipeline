import { createAgyRuntime } from '../feature/agents/clients/agy/index.ts';
import { createClaudeRuntime } from '../feature/agents/clients/claude/index.ts';
import { createClineRuntime } from '../feature/agents/clients/cline/index.ts';
import { createCodexRuntime } from '../feature/agents/clients/codex/index.ts';
import { createCopilotRuntime } from '../feature/agents/clients/copilot/index.ts';
import { createKiloRuntime } from '../feature/agents/clients/kilo/index.ts';
import { NamingClient } from '../feature/agents/clients/naming/index.ts';
import { createOpencodeRuntime } from '../feature/agents/clients/opencode/index.ts';
import { runCommand } from '../platform/process/index.ts';
import { createAgentsServices, type AgentsServices } from '../feature/agents/services/index.ts';

/** The services of `agents` with the adapters of both agent CLIs. */
export function createAgents(environment: NodeJS.ProcessEnv): AgentsServices {
  return createAgentsServices({
    environment,
    factories: {
      claude: createClaudeRuntime,
      opencode: createOpencodeRuntime,
      agy: createAgyRuntime,
      codex: createCodexRuntime,
      kilo: createKiloRuntime,
      cline: createClineRuntime,
      copilot: createCopilotRuntime,
    },
    naming: new NamingClient(),
    commands: runCommand,
  });
}
