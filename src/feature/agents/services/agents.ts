import {
  defaultRuntimes,
  type Runtime as RuntimeName,
  type RuntimeSettings,
} from '../../swarm-config/types/index.ts';
import type { CommandRunner, NamingPort, RuntimeFactories } from '../ports/index.ts';
import type {
  ModelCatalogs,
  RunNaming,
  Runtime,
  RuntimeCatalogs,
  RuntimeModels,
} from '../types/index.ts';

import { mcpServers, skillCatalog, sortEntries } from './catalog.ts';

const RUNTIME_NAMES: readonly RuntimeName[] = ['claude', 'opencode', 'agy'];

const envName = (name: RuntimeName): string => `AIP_${name.toUpperCase()}_BIN`;

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
    return factories[name](environment[envName(name)] || command, { args, env });
  }

  /**
   * Whether the runtime may be started: the `enabled` of the settings, and while it is not set,
   * a non-empty `AIP_<NAME>_BIN`. Without either the runtime is off.
   */
  isEnabled(name: RuntimeName, settings: RuntimeSettings = defaultRuntimes()): boolean {
    return settings[name].enabled ?? Boolean(this.dependencies.environment[envName(name)]);
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
    // the switches are part of the key: turning a runtime on must not show the empty catalog
    const key = `${repository}\0${RUNTIME_NAMES.map((name) => Number(this.isEnabled(name, settings))).join('')}`;
    const cached = this.modelCache.get(key);
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
    const list = (name: RuntimeName): Promise<RuntimeModels> =>
      this.isEnabled(name, settings)
        ? this.runtimeFor(name, settings).listModels(repository, run)
        : Promise.resolve({ models: [], error: null });
    const pending = Promise.all([list('claude'), list('opencode'), list('agy')]).then(
      ([claude, opencode, agy]) => ({ claude, opencode, agy }),
    );
    this.modelCache.set(key, pending);
    void pending.then((catalogs) => {
      const failed = Object.values(catalogs).some((entry) => entry.error !== null);
      if (failed && this.modelCache.get(key) === pending) this.modelCache.delete(key);
    });
    return pending;
  }

  /** The title and the name of a run from the answer of the naming agent. */
  parseNaming(answer: string): RunNaming | null {
    return this.dependencies.naming.parse(answer);
  }
}
