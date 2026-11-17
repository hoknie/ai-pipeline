import { findExecutable } from '../../../platform/process/index.ts';
import {
  knownProviders,
  type Provider,
  type ProviderAccess,
  type ResolvedConfig,
  type Runtime,
} from '../../swarm-config/types/index.ts';
import {
  accessState,
  providerStatus,
  type AccessModels,
  type AccessState,
  type ProviderState,
} from '../types/providers/providers.ts';
import type { AgentsService } from './agents.ts';

type ProviderConfig = Pick<ResolvedConfig, 'providers' | 'runtimes'>;

/** The status and the models of the providers of a configuration. */
export class ProvidersService {
  private readonly agents: AgentsService;

  constructor(agents: AgentsService) {
    this.agents = agents;
  }

  /** The state of every provider of the configuration, sorted by slug; nothing is cached or started. */
  status(config: ProviderConfig): ProviderState[] {
    return knownProviders(config).map((provider) => this.stateOf(config, provider));
  }

  stateOf(config: ProviderConfig, provider: Provider): ProviderState {
    const access = provider.access.map((item, index) => this.accessOf(config, item, index));
    const { status, active } = providerStatus(provider.enabled, access);
    return {
      slug: provider.slug,
      name: provider.name,
      level: provider.level,
      enabled: provider.enabled,
      status,
      active,
      access,
    };
  }

  private accessOf(config: ProviderConfig, access: ProviderAccess, index: number): AccessState {
    const base = { accessEnabled: access.enabled, keyEnv: access.endpoint?.keyEnv ?? null };
    if (access.kind === 'api') {
      return accessState(index, access, {
        ...base,
        runtime: null,
        runtimeEnabled: false,
        command: null,
        commandFound: false,
        keySet: false,
      });
    }
    const settings = config.runtimes[access.runtime];
    const command = this.agents.commandFor(access.runtime, config.runtimes, access.command);
    const environment = { ...this.agents.environment, ...settings.env };
    return accessState(index, access, {
      ...base,
      runtime: access.runtime,
      runtimeEnabled: this.agents.isEnabled(access.runtime, config.runtimes),
      command,
      commandFound: findExecutable(command, environment.PATH) !== null,
      keySet: access.endpoint === undefined || Boolean(environment[access.endpoint.keyEnv]),
    });
  }

  /** The models of every route of the provider for autocomplete; an error of one route is its own. */
  async models(
    repository: string,
    config: ProviderConfig,
    provider: Provider,
    refresh = false,
  ): Promise<AccessModels[]> {
    const opencode = provider.access.some(
      (item) => item.kind === 'cli' && item.runtime === 'opencode',
    );
    const catalogs = opencode
      ? await this.agents.models(repository, config.runtimes, refresh)
      : null;
    // Claude Code cannot list its models: the adapter answers from a built-in list and runs nothing.
    const builtin = await this.agents
      .runtimeFor('claude', config.runtimes)
      .listModels(repository, () => Promise.reject(new Error('the models of claude are built in')));
    return provider.access.map((access, index): AccessModels => {
      if (access.kind === 'api') {
        return { index, runtime: null, models: [], error: null, manual: true };
      }
      if (access.runtime === 'claude') {
        return { index, runtime: 'claude', ...builtin, manual: false };
      }
      if (access.runtime !== 'opencode' || catalogs === null) {
        return { index, runtime: access.runtime, models: [], error: null, manual: true };
      }
      const catalog = catalogs.opencode;
      const prefix = access.modelPrefix === undefined ? null : `${access.modelPrefix}/`;
      const models =
        prefix === null
          ? catalog.models
          : catalog.models
              .filter((entry) => entry.id.startsWith(prefix))
              .map((entry) => ({ ...entry, id: entry.id.slice(prefix.length) }));
      return { index, runtime: 'opencode', models, error: catalog.error, manual: false };
    });
  }
}
