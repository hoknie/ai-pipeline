import { isAbsolute, join } from 'node:path';

export const CONFIG_DIR = 'aip';
export const SETTINGS_NAME = 'settings';
export const SPECIALISTS_DIR = 'specialists';
export const PIPELINES_DIR = 'pipelines';
/** The old name of the pipelines directory; still read, never created. */
export const LEGACY_PIPELINES_DIR = 'workflows';
export const ACTIONS_DIR = 'actions';

export interface LevelPaths {
  /** Directory with settings.yaml, specialists/, pipelines/ and actions/. */
  directory: string;
  /** Files and directories of the old single-file layout; only used to explain the move. */
  legacy: string[];
}

export interface ConfigPaths {
  global: LevelPaths;
  project: LevelPaths;
}

export function configPaths(
  repositoryRoot: string,
  xdgConfigHome: string | undefined,
  home: string | undefined,
): ConfigPaths {
  const configHome =
    xdgConfigHome && isAbsolute(xdgConfigHome) ? xdgConfigHome : join(home ?? '.', '.config');
  return {
    global: {
      directory: join(configHome, CONFIG_DIR),
      legacy: [join(configHome, CONFIG_DIR, 'swarm.yaml'), join(configHome, CONFIG_DIR, 'swarm.d')],
    },
    project: {
      directory: join(repositoryRoot, CONFIG_DIR),
      legacy: [join(repositoryRoot, 'swarm.yaml'), join(repositoryRoot, 'swarm.d')],
    },
  };
}

export function configPathsFromEnvironment(repositoryRoot: string): ConfigPaths {
  return configPaths(repositoryRoot, process.env.XDG_CONFIG_HOME, process.env.HOME);
}
