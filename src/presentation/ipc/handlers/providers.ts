import { rejected } from '../../../platform/errors/index.ts';
import { modelMatrix, type ProviderState } from '../../../feature/agents/types/index.ts';
import {
  ConfigLoadError,
  type Provider,
  configLoadErrors,
  type ResolvedConfig,
  unknownProviderMessage,
} from '../../../feature/swarm-config/types/index.ts';
import type { ProviderView, ProvidersView } from '../contract/index.ts';
import type { HandlerTable, IpcContext } from './types.ts';

/** The file a provider was read from: the project one for a project provider. */
function fileOf(files: readonly string[], provider: Provider, project: string): string | null {
  const own = files.filter((file) => new RegExp(`/providers/${provider.slug}\\.ya?ml$`).test(file));
  const inProject = own.find((file) => file.startsWith(`${project}/`));
  return (
    (provider.level === 'project' ? inProject : own.find((file) => file !== inProject)) ?? null
  );
}

/** The roles, the providers with their state and the matrix of the configuration. */
export function providersView(
  repository: string,
  config: ResolvedConfig,
  states: readonly ProviderState[],
  files: readonly string[],
  project: string,
  holds: ReadonlyMap<string, number> = new Map(),
): ProvidersView {
  const providers = states.map((state): ProviderView => {
    const provider = config.providers.find((item) => item.slug === state.slug) as Provider;
    return {
      ...state,
      file: fileOf(files, provider, project),
      access: state.access.map((access) => ({
        ...access,
        models: provider.access[access.index]?.models ?? {},
      })),
      models: provider.models,
      limitUntil: holds.get(state.slug) ?? null,
    };
  });
  const order = new Map(states.map((state, index) => [state.slug, index]));
  const sorted = [...config.providers].sort(
    (a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0),
  );
  return {
    repository,
    errors: [],
    roles: config.roles.map((role) => ({ ...role })),
    providers,
    defaultProvider: config.defaultProvider,
    matrix: modelMatrix(config.roles, sorted),
  };
}

/** The configuration of the repository; a configuration that does not load is a refusal. */
function loaded(
  services: IpcContext['services'],
  repository: string,
  level?: 'global',
): { config: ResolvedConfig; files: string[] } | ConfigLoadError {
  try {
    const { config, files } =
      level === 'global'
        ? services.config.loadGlobalSources(repository)
        : services.config.loadSources(repository);
    return { config, files };
  } catch (error) {
    if (error instanceof ConfigLoadError) return error;
    throw error;
  }
}

/** Providers and roles: the registry with status and matrix, and the models for autocomplete. */
export const providerHandlers = {
  config_providers: async (params, { services }): Promise<ProvidersView> => {
    const repository = await services.registry.rootOf(params.repository);
    const result = loaded(services, repository, params.level);
    if (result instanceof ConfigLoadError) {
      return {
        repository,
        errors: configLoadErrors(result),
        roles: [],
        providers: [],
        defaultProvider: null,
        matrix: [],
      };
    }
    const { config, files } = result;
    const project = services.config.pathsOf(repository).project.directory;
    const holds = services.runs.reads.providerHolds(services.now());
    return providersView(
      repository,
      config,
      services.providers.status(config),
      files,
      project,
      holds,
    );
  },
  provider_models: async (params, { services }) => {
    const repository = await services.registry.rootOf(params.repository);
    const result = loaded(services, repository, params.level);
    if (result instanceof ConfigLoadError) {
      throw rejected(
        `configuration not loaded: ${result.message.split('\n')[1]?.trim() ?? result.message}`,
      );
    }
    const { config } = result;
    const provider = config.providers.find((item) => item.slug === params.provider);
    if (provider === undefined) throw rejected(unknownProviderMessage(config, params.provider));
    const access = await services.providers.models(
      repository,
      config,
      provider,
      params.refresh ?? false,
    );
    return { repository, provider: provider.slug, access };
  },
} satisfies Partial<HandlerTable>;
