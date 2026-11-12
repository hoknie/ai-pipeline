import type { ProjectChanges } from '../../../shared/api/systemApi.ts';
import type { RepositoryView } from '../../../shared/api/types.ts';
import { directoryLabel } from '../../../shared/lib/catalog/repositories.ts';

/** The address part of the form of a new project. */
export const NEW_PROJECT = 'new';

/** The colors a project may take, in the order of the palette. */
export const PROJECT_COLOR_NAMES = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
  'brown',
] as const;

/** What the form of a project edits; an empty name means the directory name. */
export interface ProjectDraft {
  name: string;
  slug: string;
  enabled: boolean;
  color: string | null;
}

export const draftOf = (project: RepositoryView): ProjectDraft => ({
  name: project.name ?? '',
  slug: project.slug,
  enabled: project.enabled,
  color: project.color,
});

/** The fields of the draft that differ from the project; an empty name drops the name. */
export function changesOf(project: RepositoryView, draft: ProjectDraft): ProjectChanges {
  const name = draft.name.trim() === '' ? null : draft.name.trim();
  return {
    ...(name !== project.name ? { name } : {}),
    ...(draft.slug.trim() !== project.slug ? { slug: draft.slug.trim() } : {}),
    ...(draft.enabled !== project.enabled ? { enabled: draft.enabled } : {}),
    ...(draft.color !== project.color ? { color: draft.color } : {}),
  };
}

export type ProjectField = 'name' | 'slug' | 'color' | 'path';

/** The field a refusal of the daemon is about; null when it is about the project as a whole. */
export function fieldOfError(message: string): ProjectField | null {
  if (/slug/i.test(message)) return 'slug';
  if (/color/i.test(message)) return 'color';
  if (/name/i.test(message)) return 'name';
  if (/git|path|director|already registered/i.test(message)) return 'path';
  return null;
}

/** All projects of the registry, disabled ones too, by label ignoring case, then by path. */
export function sortedProjects(registry: readonly RepositoryView[]): RepositoryView[] {
  return [...registry].sort(
    (left, right) =>
      left.label.localeCompare(right.label, 'en', { sensitivity: 'base' }) ||
      left.path.localeCompare(right.path, 'en'),
  );
}

/** Whether the label, the slug or the path of a project contains the query, ignoring case. */
export function projectMatches(project: RepositoryView, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return true;
  return [project.label, project.slug, project.path, project.displayPath].some((text) =>
    text.toLocaleLowerCase().includes(needle),
  );
}

/** The directory name the empty name field stands for. */
export const placeholderName = (project: RepositoryView): string => directoryLabel(project.path);
