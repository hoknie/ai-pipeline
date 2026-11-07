import { configPaths, loadRuntimeSettings } from '../../../feature/swarm-config/services/index.ts';

import type { ExecResult, SetupDeps } from './types.ts';

export function failure(result: ExecResult): string {
  return (result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`)
    .split('\n')
    .slice(0, 3)
    .join(' ');
}

export function hostBinary(
  deps: SetupDeps,
  variable: 'AIP_CLAUDE_BIN' | 'AIP_OPENCODE_BIN',
  name: 'claude' | 'opencode',
): string | null {
  if (deps.env[variable]) return deps.find(deps.env[variable]);
  let command = name as string;
  try {
    command = loadRuntimeSettings(configPaths(deps.root, deps.env.XDG_CONFIG_HOME, deps.env.HOME))[
      name
    ].command;
  } catch {
    // The default command of a runtime is its name.
  }
  return deps.find(command);
}
