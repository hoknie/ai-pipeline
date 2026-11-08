export const KEYED_SECTIONS = new Set([
  'defaults',
  'claude',
  'delivery',
  'workspace',
  'naming',
  'specialists',
  'chains',
  'pipelines',
  'actions',
  'stages',
]);

type Mapping = Record<string, unknown>;

export function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeConfigs(global: unknown, project: unknown): unknown {
  if (global === undefined) return project;
  if (project === undefined) return global;
  if (!isMapping(project)) return project;
  if (!isMapping(global)) return project;
  const merged: Mapping = { ...global };
  for (const [key, value] of Object.entries(project)) {
    merged[key] = key === 'swarm' && key in global ? mergeSwarm(global[key], value) : value;
  }
  return merged;
}

function mergeSwarm(global: unknown, project: unknown): unknown {
  if (!isMapping(project)) return project;
  if (!isMapping(global)) return project;
  const merged: Mapping = { ...global };
  for (const [key, value] of Object.entries(project)) {
    const previous = global[key];
    merged[key] =
      KEYED_SECTIONS.has(key) && isMapping(previous) && isMapping(value)
        ? { ...previous, ...value }
        : value;
  }
  return merged;
}

/** A parsed configuration file; `value` is undefined for an empty file. */
export interface ConfigSource {
  path: string;
  value: unknown;
  /** The text of the file, when it was read from disk. */
  text?: string;
}
