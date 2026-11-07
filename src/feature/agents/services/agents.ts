import {
  defaultRuntimes,
  type Runtime as RuntimeName,
  type RuntimeSettings,
} from '../../swarm-config/types/index.ts';
import type { NamingPort, RuntimeFactories } from '../ports/index.ts';
import type { RunNaming, Runtime, RuntimeCatalogs } from '../types/index.ts';

import { mcpServers, skillCatalog, sortEntries } from './catalog.ts';

export interface AgentsDependencies {
  /** The environment agents start in; `AIP_CLAUDE_BIN` and `AIP_OPENCODE_BIN` replace the executables. */
  environment: NodeJS.ProcessEnv;
  factories: RuntimeFactories;
  naming: NamingPort;
}

/** The adapters of the agent CLIs and what a specialist of each can name. */
export class AgentsService {
  private readonly dependencies: AgentsDependencies;

  constructor(dependencies: AgentsDependencies) {
    this.dependencies = dependencies;
  }

  get environment(): NodeJS.ProcessEnv {
    return this.dependencies.environment;
  }

  /** The adapter of a runtime with the executable and extras of the settings. */
  runtimeFor(name: RuntimeName, settings: RuntimeSettings = defaultRuntimes()): Runtime {
    const { environment, factories } = this.dependencies;
    const { command, args, env } = settings[name];
    return name === 'claude'
      ? factories.claude(environment.AIP_CLAUDE_BIN || command, { args, env })
      : factories.opencode(environment.AIP_OPENCODE_BIN || command, { args, env });
  }

  /** Tools and skills a specialist of each runtime can name, read from disk on every call. */
  catalog(repository: string, home: string): RuntimeCatalogs {
    const build = (name: RuntimeName) => {
      const runtime = this.runtimeFor(name);
      const servers = name === 'claude' ? mcpServers(repository, home) : [];
      return {
        tools: sortEntries([
          ...runtime.builtinTools.map((tool) => ({ name: tool, source: 'builtin' as const })),
          ...servers,
        ]),
        skills: skillCatalog(runtime.skillDirectories(repository, home), repository, home),
      };
    };
    return { claude: build('claude'), opencode: build('opencode') };
  }

  /** The title and the name of a run from the answer of the naming agent. */
  parseNaming(answer: string): RunNaming | null {
    return this.dependencies.naming.parse(answer);
  }
}
