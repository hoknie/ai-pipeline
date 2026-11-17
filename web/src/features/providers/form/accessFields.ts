/** The CLIs a provider can be reached through. */
export const RUNTIME_OPTIONS = [
  'claude',
  'opencode',
  'agy',
  'codex',
  'kilo',
  'cline',
  'copilot',
] as const;

const PREFIX_RUNTIMES: readonly string[] = ['opencode', 'kilo'];
const ENDPOINT_RUNTIMES: readonly string[] = ['claude', 'codex', 'kilo', 'cline', 'copilot'];

/** Which fields of an access the form shows. */
export interface AccessFields {
  modelPrefix: boolean;
  endpoint: boolean;
  /** `command` and `args`: only the shared level may set them. */
  command: boolean;
}

export function accessFields(runtime: string, level: 'global' | 'project'): AccessFields {
  return {
    modelPrefix: PREFIX_RUNTIMES.includes(runtime),
    endpoint: ENDPOINT_RUNTIMES.includes(runtime),
    command: level === 'global',
  };
}

/** Whether the provider has an access through OpenCode: only then a model takes options. */
export const hasOpencode = (accesses: readonly { kind: string; runtime: string }[]): boolean =>
  accesses.some((access) => access.kind === 'cli' && access.runtime === 'opencode');
