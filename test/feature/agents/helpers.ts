import { createAgents } from '../../../src/app/agents.ts';
import type { RuntimeCatalogs, Runtime } from '../../../src/feature/agents/types/index.ts';
import type {
  Runtime as RuntimeName,
  RuntimeSettings,
} from '../../../src/feature/swarm-config/types/index.ts';

/** The adapter `aip` would start for the runtime in this environment. */
export function runtimeFor(
  name: RuntimeName,
  environment: NodeJS.ProcessEnv,
  settings?: RuntimeSettings,
): Runtime {
  return createAgents(environment).agents.runtimeFor(name, settings);
}

/** The catalog of tools and skills `aip` would show for the repository. */
export function runtimeCatalog(
  repository: string,
  home: string,
  environment: NodeJS.ProcessEnv,
): RuntimeCatalogs {
  return createAgents(environment).agents.catalog(repository, home);
}
