import { resolve } from 'node:path';

import { configPaths, loadWebSettings } from '../../src/feature/swarm-config/services/index.ts';
import type { DaemonPanelOptions } from '../../src/presentation/web/index.ts';

/** Reads the `web` section of the settings the way `aip daemon` does, for the given environment. */
export function settingsFrom(environment: NodeJS.ProcessEnv = {}, cwd: string = resolve('.')) {
  return () => loadWebSettings(configPaths(cwd, environment.XDG_CONFIG_HOME, environment.HOME));
}

/** Adds `readSettings` from the `environment` of the options. */
export function withSettings(
  options: Omit<DaemonPanelOptions, 'readSettings'>,
  cwd?: string,
): DaemonPanelOptions {
  return { ...options, readSettings: settingsFrom(options.environment, cwd) };
}
