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

/** The shared file of a provider that a project file overrides; null without one. */
export function overriddenOf(provider: EditorProvider | undefined): boolean {
  return provider?.level === 'project_over_global';
}
