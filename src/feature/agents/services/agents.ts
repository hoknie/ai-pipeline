import {
  defaultRuntimes,
  type Runtime as RuntimeName,
  type RuntimeSettings,
} from '../../swarm-config/types/index.ts';
import type { CommandRunner, NamingPort, RuntimeFactories } from '../ports/index.ts';
import type { ModelCatalogs, RunNaming, Runtime, RuntimeCatalogs } from '../types/index.ts';

import { mcpServers, skillCatalog, sortEntries } from './catalog.ts';

export interface AgentsDependencies {
  /** The environment agents start in; `AIP_<RUNTIME>_BIN` replaces each executable. */
  environment: NodeJS.ProcessEnv;
  factories: RuntimeFactories;
  naming: NamingPort;
  commands: CommandRunner;
}

/** The adapters of the agent CLIs and what a specialist of each can name. */
export class AgentsService {
  private readonly dependencies: AgentsDependencies;
  private readonly modelCache = new Map<string, Promise<ModelCatalogs>>();

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
    return factories[name](environment[`AIP_${name.toUpperCase()}_BIN`] || command, { args, env });
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
    return { claude: build('claude'), opencode: build('opencode'), agy: build('agy') };
  }

  /**
   * The models of every runtime, cached per repository. A catalog with a failed runtime is not kept,
   * so the next request tries again; `refresh` replaces the entry.
   */
  models(repository: string, settings: RuntimeSettings, refresh = false): Promise<ModelCatalogs> {
    const cached = this.modelCache.get(repository);
    if (cached && !refresh) return cached;
    const { commands, environment } = this.dependencies;
    // the command starts in the environment agents start in, under the variables of the settings
    const run: CommandRunner = (file, args, options) =>
      commands(file, args, {
        ...options,
        env: {
          ...Object.fromEntries(
            Object.entries(environment).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          ),
          ...options.env,
        },
      });
    const list = (name: RuntimeName) => this.runtimeFor(name, settings).listModels(repository, run);
    const pending = Promise.all([list('claude'), list('opencode'), list('agy')]).then(
      ([claude, opencode, agy]) => ({ claude, opencode, agy }),
    );
    this.modelCache.set(repository, pending);
    void pending.then((catalogs) => {
      const failed = Object.values(catalogs).some((entry) => entry.error !== null);
      if (failed && this.modelCache.get(repository) === pending) this.modelCache.delete(repository);
    });
    return pending;
  }

  /** The title and the name of a run from the answer of the naming agent. */
  parseNaming(answer: string): RunNaming | null {
    return this.dependencies.naming.parse(answer);
  }
}
