import { Rejection } from './errors.ts';

export const TAG_COLORS = [
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

export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_NAME_LIMIT = 30;

export interface Tag {
  id: string;
  name: string;
  color: TagColor;
  createdAt: number;
}

function fold(name: string): string {
  return name.trim().toLocaleLowerCase('und');
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new Rejection('tag name must not be empty');
  if ([...trimmed].length > TAG_NAME_LIMIT) {
    throw new Rejection(`tag name must be at most ${TAG_NAME_LIMIT} characters`);
  }
  if (/[\r\n]/.test(trimmed)) throw new Rejection('tag name must not contain a line break');
  return trimmed;
}

function cleanColor(color: string): TagColor {
  if (!(TAG_COLORS as readonly string[]).includes(color)) {
    throw new Rejection(`unknown color \`${color}\`; known: ${TAG_COLORS.join(', ')}`);
  }
  return color as TagColor;
}

function checkUnique(catalog: readonly Tag[], name: string, except: string | null): void {
  const same = catalog.find((tag) => tag.id !== except && fold(tag.name) === fold(name));
  if (same) throw new Rejection(`tag \`${same.name}\` already exists`);
}

/** Finds a tag by name, ignoring case and surrounding spaces. */
export function findTag(catalog: readonly Tag[], name: string): Tag {
  const tag = catalog.find((candidate) => fold(candidate.name) === fold(name));
  if (!tag) {
    const shown = name.trim();
    throw new Rejection(`unknown tag \`${shown}\`; create it with \`aip tag add ${shown}\``);
  }
  return tag;
}

export function addTag(
  catalog: readonly Tag[],
  input: { name: string; color?: string | undefined },
  id: string,
  now: number,
): Tag {
  const name = cleanName(input.name);
  const color =
    input.color === undefined
      ? (TAG_COLORS[catalog.length % TAG_COLORS.length] ?? 'gray')
      : cleanColor(input.color);
  checkUnique(catalog, name, null);
  return { id, name, color, createdAt: now };
}

/** Returns the changed copy of the tag; the catalog itself is not modified. */
export function editTag(
  catalog: readonly Tag[],
  name: string,
  patch: { name?: string | undefined; color?: string | undefined },
): Tag {
  const tag = findTag(catalog, name);
  if (patch.name === undefined && patch.color === undefined) {
    throw new Rejection('pass a new name or a new color');
  }
  const next = patch.name === undefined ? tag.name : cleanName(patch.name);
  const color = patch.color === undefined ? tag.color : cleanColor(patch.color);
  checkUnique(catalog, next, tag.id);
  return { ...tag, name: next, color };
}

/** Returns the tag to remove; the catalog itself is not modified. */
export function removeTag(catalog: readonly Tag[], name: string): Tag {
  return findTag(catalog, name);
}

/** Names to ids; no duplicates, order of first appearance, an unknown name rejects all. */
export function resolveTags(catalog: readonly Tag[], names: readonly string[]): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const { id } = findTag(catalog, name);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Drops ids that are no longer in the catalog. */
export function knownTags(catalog: readonly Tag[], ids: readonly string[]): string[] {
  const present = new Set(catalog.map((tag) => tag.id));
  return ids.filter((id) => present.has(id));
}

/** Union of tag id lists; no duplicates, order of first appearance. */
export function mergeTags(...lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())];
}

function shorten(name: string, limit: number): string {
  const chars = [...name];
  if (chars.length <= limit) return name;
  const cut = chars.slice(0, limit).join('');
  const dash = cut.lastIndexOf('-');
  const word = chars[limit] === '-' ? cut : dash > 0 ? cut.slice(0, dash) : cut;
  return word.replace(/-+$/, '');
}

/**
 * A free tag name made from `base`: cut to the limit at the last whole word (split by `-`),
 * with `-2`, `-3`, … added while the name is taken (case does not matter).
 */
export function autoTagName(catalog: readonly Tag[], base: string): string {
  const clean = shorten(base.replace(/\s+/g, ' ').trim(), TAG_NAME_LIMIT).trim() || 'tag';
  const taken = new Set(catalog.map((tag) => fold(tag.name)));
  if (!taken.has(fold(clean))) return clean;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const name = `${shorten(clean, TAG_NAME_LIMIT - suffix.length)}${suffix}`;
    if (!taken.has(fold(name))) return name;
  }
}
