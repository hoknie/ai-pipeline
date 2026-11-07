import { homedir } from 'node:os';

import {
  ConfigLoadError,
  pipelineNameOf,
  type ConfigPaths,
  type DeliveryMode,
  type ResolvedConfig,
  type RuntimeSettings,
} from '../types/index.ts';

import { configPaths } from './discover.ts';
import { loadConfig, loadRuntimeSettings } from './load.ts';

/** What the queue view shows from the configuration of a repository; nulls when it does not load. */
export interface DeliverySettings {
  auto: boolean | null;
  mode: DeliveryMode | null;
  names: (id: string) => string;
}

/** The configuration files of the repositories, read from disk on every call. */
export class ConfigService {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(dependencies: { environment: NodeJS.ProcessEnv }) {
    this.environment = dependencies.environment;
  }

  /** The home directory of the user, as the environment of the daemon says. */
  home(): string {
    return this.environment.HOME || homedir();
  }

  pathsOf(repository: string): ConfigPaths {
    return configPaths(repository, this.environment.XDG_CONFIG_HOME, this.environment.HOME);
  }

  /** The merged configuration of the repository; throws `ConfigLoadError`. */
  load(repository: string): ResolvedConfig {
    return loadConfig(this.pathsOf(repository));
  }

  /** `delivery.auto`, `delivery.mode` and pipeline names of the repository now. */
  delivery(repository: string): DeliverySettings {
    try {
      const config = this.load(repository);
      return {
        auto: config.delivery.auto,
        mode: config.delivery.mode,
        names: (id) => pipelineNameOf(config, id),
      };
    } catch (error) {
      if (error instanceof ConfigLoadError) return { auto: null, mode: null, names: (id) => id };
      throw error;
    }
  }

  /** Current `runtimes` of the shared settings.yaml, or the text of the error in it. */
  runtimeSettings(repository: string): RuntimeSettings | string {
    try {
      return loadRuntimeSettings(this.pathsOf(repository));
    } catch (error) {
      if (!(error instanceof ConfigLoadError)) throw error;
      return `invalid swarm.runtimes: ${error.message}`;
    }
  }
}
