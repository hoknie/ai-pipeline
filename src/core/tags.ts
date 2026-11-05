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

/** The 11th color, reserved for tags of linked tasks; it is not in the palette. */
export const CHAIN_TAG_COLOR = 'indigo';

export type TagColor = (typeof TAG_COLORS)[number] | typeof CHAIN_TAG_COLOR;

/** The task a tag was made for: the run id and its number in the repository. */
export interface TagTask {
  run: string;
  number: number;
}

export const TAG_NAME_LIMIT = 30;

export interface Tag {
  id: string;
  /** The repository (absolute root) whose catalog holds the tag. */
  repository: string;
  name: string;
  color: TagColor;
  createdAt: number;
  task: TagTask | null;
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
  if (color === CHAIN_TAG_COLOR) {
    throw new Rejection(`color \`${CHAIN_TAG_COLOR}\` is reserved for linked task tags`);
  }
  if (!(TAG_COLORS as readonly string[]).includes(color)) {
    throw new Rejection(`unknown color \`${color}\`; known: ${TAG_COLORS.join(', ')}`);
  }
  return color as TagColor;
}

function checkUnique(catalog: readonly Tag[], name: string, except: string | null): void {
  const same = catalog.find((tag) => tag.id !== except && fold(tag.name) === fold(name));
  if (same) throw new Rejection(`tag \`${same.name}\` already exists`);
}

/** The tags of one repository. */
export function tagsOfRepository(catalog: readonly Tag[], repository: string): Tag[] {
  return catalog.filter((tag) => tag.repository === repository);
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
  input: { name: string; color?: string | undefined; repository: string },
  id: string,
  now: number,
): Tag {
  const name = cleanName(input.name);
  const color =
    input.color === undefined
      ? (TAG_COLORS[catalog.length % TAG_COLORS.length] ?? 'gray')
      : cleanColor(input.color);
  checkUnique(catalog, name, null);
  return { id, repository: input.repository, name, color, createdAt: now, task: null };
}

/** A tag of a linked task: the reserved color, the source task is fixed. */
export function addLinkedTag(
  catalog: readonly Tag[],
  input: { name: string; task: TagTask; repository: string },
  id: string,
  now: number,
): Tag {
  const name = cleanName(input.name);
  checkUnique(catalog, name, null);
  return {
    id,
    repository: input.repository,
    name,
    color: CHAIN_TAG_COLOR,
    createdAt: now,
    task: { ...input.task },
  };
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
  if (tag.task !== null && patch.color !== undefined) {
    throw new Rejection('linked task tag color cannot be changed');
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

/** Like `resolveTags` for names given by a person: a tag of a linked task is refused. */
export function resolveManualTags(catalog: readonly Tag[], names: readonly string[]): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const tag = findTag(catalog, name);
    if (tag.task !== null) {
      throw new Rejection(
        `tag \`${tag.name}\` belongs to task #${tag.task.number} and is set automatically`,
      );
    }
    if (!ids.includes(tag.id)) ids.push(tag.id);
  }
  return ids;
}

/** Linked task tags of `current` first in their order, then `next` without repeats. */
export function keepLinkedTags(
  catalog: readonly Tag[],
  current: readonly string[],
  next: readonly string[],
): string[] {
  const linked = new Set(catalog.filter((tag) => tag.task !== null).map((tag) => tag.id));
  return mergeTags(
    current.filter((id) => linked.has(id)),
    next,
  );
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

/** The linked task tag of a run: the earliest one made for it, if any. */
export function linkedTagOf(catalog: readonly Tag[], runId: string): Tag | undefined {
  let found: Tag | undefined;
  for (const tag of catalog) {
    if (tag.task?.run !== runId) continue;
    if (!found || tag.createdAt < found.createdAt) found = tag;
  }
  return found;
}

/** The ids without the tags of linked tasks. */
export function withoutLinkedTags(catalog: readonly Tag[], ids: readonly string[]): string[] {
  const linked = new Set(catalog.filter((tag) => tag.task !== null).map((tag) => tag.id));
  return ids.filter((id) => !linked.has(id));
}

/** A parent reference: a run id candidate and/or a task number candidate. */
export interface ParentRef {
  id: string | null;
  number: number | null;
}

/** `161`, `#161` and `161` as a number are task numbers; a string is also a run id. */
export function parseParentRef(value: string | number): ParentRef {
  if (typeof value === 'number') return { id: null, number: value };
  const text = value.trim();
  const match = /^#?(\d+)$/.exec(text);
  const number = match ? Number(match[1]) : null;
  return { id: text, number: number !== null && number > 0 ? number : null };
}
