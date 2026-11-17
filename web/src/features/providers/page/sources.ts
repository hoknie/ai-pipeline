import type { EditorProvider, WriteLevel } from '../../../shared/api/types.ts';

export type Raw = Record<string, unknown>;

/** The file of a provider that applies, with the revision a write must name. */
export interface ProviderSource {
  level: WriteLevel;
  file: string;
  revision: string;
  raw: Raw;
}

/** The file of the level of a provider: the project one when it has one, else the shared one. */
export function sourceOf(provider: EditorProvider | undefined): ProviderSource | null {
  if (!provider) return null;
  const level: WriteLevel = provider.level === 'global' ? 'global' : 'project';
  const source = provider.sources[level];
  return source ? { level, ...source } : null;
}

/** The shared file of a provider that a project file overrides; null without one. */
export function overriddenOf(provider: EditorProvider | undefined): boolean {
  return provider?.level === 'project_over_global';
}
