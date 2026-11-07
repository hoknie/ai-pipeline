import { isAbsolute, join } from 'node:path';
import { CONFIG_DIR, type ConfigPaths } from '../types/levels.ts';

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

export function configPathsFromEnvironment(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv,
): ConfigPaths {
  return configPaths(repositoryRoot, environment.XDG_CONFIG_HOME, environment.HOME);
}
