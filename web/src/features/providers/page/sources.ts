import type { EditorProvider, WriteLevel } from '../../../shared/api/types.ts';

export type Raw = Record<string, unknown>;

/** The file of a provider that applies, with the revision a write must name. */
export interface ProviderSource {
  level: WriteLevel;
  file: string;
  revision: string;
  raw: Raw;
}

/** The part of the configuration a page works on: the project, or the shared level alone. */
export type ProvidersScope = 'project' | 'global';

/**
 * The file of the level of a provider: the project one when it has one, else the shared one; in
 * the shared scope always the shared one.
 */
export function sourceOf(
  provider: EditorProvider | undefined,
  scope: ProvidersScope = 'project',
): ProviderSource | null {
  if (!provider) return null;
  const level: WriteLevel =
    scope === 'global' || provider.level === 'global' ? 'global' : 'project';
  const source = provider.sources[level];
  return source ? { level, ...source } : null;
}

/**
 * The file a write in the scope may change: in the project scope only the project file (a provider
 * that exists only at the shared level has none, so it is read only there), in the shared scope the
 * shared one.
 */
export function writableSourceOf(
  provider: EditorProvider | undefined,
  scope: ProvidersScope = 'project',
): ProviderSource | null {
  if (!provider) return null;
  const level: WriteLevel = scope;
  const source = provider.sources[level];
  return source ? { level, ...source } : null;
}

/** A provider that the project scope may only look at: it exists only at the shared level. */
export function sharedOnlyIn(
  provider: EditorProvider | undefined,
  scope: ProvidersScope = 'project',
): boolean {
  return (
    scope === 'project' && provider !== undefined && writableSourceOf(provider, scope) === null
  );
}

/** The shared file of a provider that a project file overrides; null without one. */
export function overriddenOf(provider: EditorProvider | undefined): boolean {
  return provider?.level === 'project_over_global';
}

/**
 * The copy of a shared provider file for the project: the same file without `command` and `args` of
 * the accesses (a project file may not run its own programs). `stripped` tells whether any was there.
 */
export function overrideValue(raw: Raw): { raw: Raw; stripped: boolean } {
  if (!Array.isArray(raw.access)) return { raw: { ...raw }, stripped: false };
  let stripped = false;
  const access = raw.access.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    const { command, args, ...rest } = item as Raw;
    if (command !== undefined || args !== undefined) stripped = true;
    return rest;
  });
  return { raw: { ...raw, access }, stripped };
}
