import { rejected } from '../../../platform/errors/index.ts';

/** The colors of a project: the palette of tags, without the color reserved for linked tasks. */
export const PROJECT_COLORS = [
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

export type ProjectColor = (typeof PROJECT_COLORS)[number];

/** What a slug looks like: lower-case letters, digits and dashes, up to 40 characters. */
export const PROJECT_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

const SLUG_LENGTH = 40;
const NAME_LENGTH = 80;

/** Whether a repository reference is a slug rather than a path. */
export function isProjectSlug(value: string): boolean {
  return PROJECT_SLUG.test(value);
}

/** The last part of a path, the name a project shows without one of its own. */
export function directoryName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1);
  return name || path;
}

/** The slug a directory name gives: lower case, other characters as dashes, at most 40. */
export function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? 'project' : slug;
}

/** The base itself when it is free, otherwise the base with the smallest free suffix `-2`, `-3`, …. */
export function freeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let number = 2; ; number += 1) {
    const suffix = `-${number}`;
    const candidate = `${base.slice(0, SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A slug the user typed; a wrong one is refused. */
export function checkSlug(slug: string): string {
  if (!isProjectSlug(slug)) {
    throw rejected(
      `project slug \`${slug}\` must be 1–40 lower-case letters, digits or dashes and start with a letter or a digit`,
    );
  }
  return slug;
}

/** A name the user typed, trimmed; null clears it. */
export function checkName(name: string | null): string | null {
  if (name === null) return null;
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > NAME_LENGTH) {
    throw rejected(`project name must be 1–${NAME_LENGTH} characters`);
  }
  return trimmed;
}

/** A color of the palette; null clears it. */
export function checkColor(color: string | null): ProjectColor | null {
  if (color === null) return null;
  if (!(PROJECT_COLORS as readonly string[]).includes(color)) {
    throw rejected(`unknown color \`${color}\`; known: ${PROJECT_COLORS.join(', ')}`);
  }
  return color as ProjectColor;
}

/** The name a project shows: its own or the name of its directory. */
export function projectLabel(project: { path: string; name: string | null }): string {
  return project.name ?? directoryName(project.path);
}
