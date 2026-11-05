import { dirname } from 'node:path';

import type { ConfigPaths } from './discover.ts';
import {
  ConfigEditError,
  commitEdit,
  draftProjectFiles,
  editDocument,
  entryFile,
  readText,
  revisionOf,
  stemOf,
  type WriteLevel,
} from './edit.ts';
import type { FieldError } from './errors.ts';
import { parseYaml, readLevel } from './load.ts';
import { isMapping } from './merge.ts';
import { isValidSlug } from './model.ts';
import { sameTag, tagNameProblem, tagsOf, uniqueTags } from './tag-names.ts';

export { tagsOf } from './tag-names.ts';

/** One specialist file of a level, as the tag editor sees it. */
export interface SpecialistTagEntry {
  slug: string;
  name: string | null;
  tags: string[];
  /** Revision of the file; null when the file could not be read. */
  revision: string | null;
  /** Why the file cannot be read; the specialist stays in the list. */
  error?: string;
}

/** The specialists of one level (shared or one project) with their tags. */
export interface SpecialistTagFolder {
  /** Directory with the specialist files of the level. */
  directory: string;
  specialists: SpecialistTagEntry[];
}

/** A file to write: its new text, or the text to restore. */
export interface TagFileEdit {
  file: string;
  text: string;
  revision: string | null;
}

export type TagPlan =
  | { ok: true; edits: TagFileEdit[] }
  | { ok: false; reason: 'invalid'; errors: FieldError[] }
  | { ok: false; reason: 'conflict'; message: string; slugs?: string[] };

/** Trimmed tags without repeats; throws `ConfigEditError` for a name that is not allowed. */
export function normalizeTags(names: readonly unknown[]): string[] {
  for (const name of names) {
    const problem = tagNameProblem(name);
    if (problem !== null) {
      throw new ConfigEditError(`tag ${JSON.stringify(name)} ${problem}`);
    }
  }
  return uniqueTags(names as string[]);
}

/** The specialists of a level in slug order; one unreadable file does not hide the others. */
export function tagFolder(paths: ConfigPaths, level: WriteLevel): SpecialistTagFolder {
  const levelPaths = paths[level];
  const files = readLevel(levelPaths, { tolerant: true });
  const byStem = new Map<string, SpecialistTagEntry>();
  for (const source of files.specialists) {
    const slug = stemOf(source.path);
    const raw = isMapping(source.value) ? source.value : {};
    byStem.set(slug, {
      slug,
      name: typeof raw.name === 'string' ? raw.name : null,
      tags: tagsOf(raw),
      revision: revisionOf(source.text),
    });
  }
  const marker = 'swarm.specialists.';
  for (const problem of files.problems) {
    if (!problem.path.startsWith(marker)) continue;
    const slug = problem.path.slice(marker.length);
    byStem.set(slug, { slug, name: null, tags: [], revision: null, error: problem.message });
  }
  const specialists = [...byStem.values()].sort((left, right) =>
    left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
  );
  return { directory: `${levelPaths.directory}/specialists`, specialists };
}

function invalid(slug: string, file: string, message: string): TagPlan {
  return {
    ok: false,
    reason: 'invalid',
    errors: [{ file, path: `swarm.specialists.${slug}.tags`, message }],
  };
}

/** The text of a file with `tags` replaced; an empty list removes the key. */
function withTags(file: string, current: string, tags: string[]): string {
  const parsed = parseYaml(current, file);
  const value: Record<string, unknown> = isMapping(parsed) ? { ...parsed } : {};
  if (tags.length === 0) delete value.tags;
  else value.tags = tags;
  return editDocument(current, value);
}

/** Sets the whole list of tags of one specialist; nothing else in the file changes. */
export function planTagsSet(
  paths: ConfigPaths,
  level: WriteLevel,
  slug: string,
  tags: readonly unknown[],
  revision: string | null,
): TagPlan {
  let file: string;
  try {
    file = entryFile(paths, 'specialist', slug, level);
  } catch (error) {
    if (!(error instanceof ConfigEditError)) throw error;
    return invalid(slug, '', error.message);
  }
  const current = readText(file);
  if (current === undefined) {
    return { ok: false, reason: 'conflict', message: `${file} does not exist any more` };
  }
  if (revisionOf(current) !== revision) {
    return { ok: false, reason: 'conflict', message: `${file} was changed after it was read` };
  }
  try {
    const normalized = normalizeTags(tags);
    const text = withTags(file, current, normalized);
    return { ok: true, edits: [{ file, text, revision: revisionOf(text) }] };
  } catch (error) {
    if (!(error instanceof ConfigEditError) && !(error instanceof Error)) throw error;
    return invalid(slug, file, error.message);
  }
}

/** Changes the tag in every specialist of the level that has it; `change` gets the tags of one file. */
function planTagChange(
  paths: ConfigPaths,
  level: WriteLevel,
  tag: string,
  change: (tags: string[]) => string[],
): TagPlan {
  const folder = tagFolder(paths, level);
  const edits: TagFileEdit[] = [];
  for (const entry of folder.specialists) {
    if (entry.error !== undefined || !entry.tags.some((name) => sameTag(name, tag))) continue;
    if (!isValidSlug(entry.slug)) continue;
    const file = entryFile(paths, 'specialist', entry.slug, level);
    const current = readText(file);
    if (current === undefined || revisionOf(current) !== entry.revision) {
      return { ok: false, reason: 'conflict', message: `${file} was changed after it was read` };
    }
    try {
      const text = withTags(file, current, change(entry.tags));
      edits.push({ file, text, revision: revisionOf(text) });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return invalid(entry.slug, file, error.message);
    }
  }
  if (edits.length === 0) {
    return {
      ok: false,
      reason: 'invalid',
      errors: [
        { file: folder.directory, path: 'tags', message: `unknown specialist tag \`${tag}\`` },
      ],
    };
  }
  return { ok: true, edits };
}

/** Renames a tag in all specialists of a level; a specialist that already has `to` just loses `from`. */
export function planTagRename(
  paths: ConfigPaths,
  level: WriteLevel,
  from: string,
  to: string,
): TagPlan {
  const problem = tagNameProblem(to);
  if (problem !== null) {
    return {
      ok: false,
      reason: 'invalid',
      errors: [{ file: '', path: 'tags', message: `tag ${JSON.stringify(to)} ${problem}` }],
    };
  }
  const target = to.trim();
  return planTagChange(paths, level, from, (tags) =>
    uniqueTags(tags.map((name) => (sameTag(name, from) ? target : name))),
  );
}

/** Removes a tag from all specialists of a level. */
export function planTagRemove(paths: ConfigPaths, level: WriteLevel, tag: string): TagPlan {
  return planTagChange(paths, level, tag, (tags) => tags.filter((name) => !sameTag(name, tag)));
}

/**
 * Copies project specialist files of `source` into the project of `target` byte for byte.
 * All or nothing: a missing source file, a taken slug or a new configuration error refuses all.
 */
export function planImport(target: ConfigPaths, source: ConfigPaths, slugs: string[]): TagPlan {
  const unique = [...new Set(slugs)];
  const label = dirname(source.project.directory);
  const copies: { slug: string; file: string; text: string }[] = [];
  for (const slug of unique) {
    if (!isValidSlug(slug)) return invalid(slug, '', 'slug is not valid');
    const text = readText(entryFile(source, 'specialist', slug, 'project'));
    if (text === undefined) {
      return invalid(slug, '', `specialist \`${slug}\` is not defined in ${label}`);
    }
    copies.push({ slug, file: entryFile(target, 'specialist', slug, 'project'), text });
  }
  const taken = copies.filter((copy) => readText(copy.file) !== undefined).map((c) => c.slug);
  if (taken.length > 0) {
    return {
      ok: false,
      reason: 'conflict',
      message: `already defined in the project: ${taken.join(', ')}`,
      slugs: taken,
    };
  }
  const errors = draftProjectFiles(
    target,
    copies.map((copy) => ({ kind: 'specialist' as const, id: copy.slug, ...copy })),
  );
  if (errors.length > 0) return { ok: false, reason: 'invalid', errors };
  return {
    ok: true,
    edits: copies.map((copy) => ({
      file: copy.file,
      text: copy.text,
      revision: revisionOf(copy.text),
    })),
  };
}

/** Writes the files one by one; when a write fails, the files already written get their old text back. */
export function commitEdits(edits: readonly TagFileEdit[]): void {
  const done: { file: string; before: string | undefined }[] = [];
  try {
    for (const edit of edits) {
      const before = readText(edit.file);
      commitEdit({ ok: true, file: edit.file, text: edit.text, revision: edit.revision });
      done.push({ file: edit.file, before });
    }
  } catch (error) {
    for (const entry of done.reverse()) {
      try {
        if (entry.before === undefined) {
          commitEdit({ ok: true, file: entry.file, text: null, revision: null });
        } else {
          commitEdit({
            ok: true,
            file: entry.file,
            text: entry.before,
            revision: revisionOf(entry.before),
          });
        }
      } catch {
        // the file is left as it is
      }
    }
    throw error;
  }
}
