import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { Document, isMap, isScalar, parseDocument, Scalar, visit } from 'yaml';
import {
  type ConfigPaths,
  isMapping,
  isValidSlug,
  LEGACY_PIPELINES_DIR,
  SETTINGS_NAME,
  SLUG_PATTERN_TEXT,
} from '../../swarm-config/types/index.ts';
import { key } from '../types/editor.ts';
import {
  ConfigEditError,
  type EditCommitted,
  type EditPlan,
  type EntryKind,
  KIND_DIRECTORY,
  type WriteLevel,
} from '../types/editor.ts';

/** sha256 of the content of a file; null for a file that does not exist. */
export function revisionOf(text: string | undefined): string | null {
  return text === undefined ? null : createHash('sha256').update(text).digest('hex');
}

/**
 * The file of an entry on a level: `specialists/<id>.yaml` (`pipelines/<id>.yaml`) in the directory of the level, or the
 * `.yml` file when that one exists. The id must be a slug, so the path cannot leave the directory of the kind.
 */
export function entryFile(
  paths: ConfigPaths,
  kind: EntryKind,
  id: string,
  level: WriteLevel = 'project',
): string {
  if (!isValidSlug(id)) throw new ConfigEditError(`id must match ${SLUG_PATTERN_TEXT}`);
  let directory = resolve(paths[level].directory, KIND_DIRECTORY[kind]);
  const yaml = join(directory, `${id}.yaml`);
  const yml = join(directory, `${id}.yml`);
  let file = !existsSync(yaml) && existsSync(yml) ? yml : yaml;
  if (kind === 'pipeline' && !existsSync(yaml) && !existsSync(yml)) {
    const legacyDirectory = resolve(paths[level].directory, LEGACY_PIPELINES_DIR);
    const legacyYaml = join(legacyDirectory, `${id}.yaml`);
    const legacyYml = join(legacyDirectory, `${id}.yml`);
    if (existsSync(legacyYaml) || existsSync(legacyYml)) {
      directory = legacyDirectory;
      file = existsSync(legacyYaml) ? legacyYaml : legacyYml;
    }
  }
  const inside = relative(directory, resolve(file));
  if (inside.startsWith('..') || inside !== basename(file)) {
    throw new ConfigEditError('the file must be inside the directory of its kind');
  }
  return file;
}

/** Deep equality of parsed YAML values; the order of keys of a mapping does not matter. */
export function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (isMapping(left) && isMapping(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => key in right && sameValue(left[key], right[key]))
    );
  }
  return left === right;
}

function literalMultiline(node: unknown): void {
  visit(node as Document, {
    Scalar(_, scalar) {
      if (typeof scalar.value === 'string' && scalar.value.includes('\n')) {
        scalar.type = Scalar.BLOCK_LITERAL;
      }
    },
  });
}

/**
 * Text of a file with `value` as its content. Only the changed keys are touched, so comments, key
 * order and the formatting of the other keys survive; keys missing from `value` are removed.
 */
export function editDocument(text: string | undefined, value: Record<string, unknown>): string {
  if (text === undefined || text.trim() === '') {
    const fresh = new Document(value);
    literalMultiline(fresh);
    const body = fresh.toString({ lineWidth: 0 });
    return Object.keys(value).length === 0 ? '{}\n' : `${text ?? ''}${body}`;
  }
  const document = parseDocument(text, { merge: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new ConfigEditError(`the file has a syntax error: ${document.errors[0]?.message ?? ''}`);
  }
  if (!isMap(document.contents)) document.contents = document.createNode({}) as never;
  const current = (document.toJS({ maxAliasCount: 100 }) ?? {}) as Record<string, unknown>;
  const map = document.contents;
  if (!isMap(map)) throw new ConfigEditError('the file must contain a mapping');
  for (const key of Object.keys(current)) {
    if (!(key in value) && document.has(key)) document.delete(key);
  }
  for (const [key, next] of Object.entries(value)) {
    const oldSplit = key === 'split' && isMapping(current[key]) && 'workflow' in current[key];
    if (!oldSplit && sameValue(current[key], next)) continue;
    const existing = document.get(key, true);
    if (isScalar(existing) && (typeof next === 'string' || typeof next === 'number')) {
      existing.value = next;
      existing.type =
        typeof next === 'string' && next.includes('\n') ? Scalar.BLOCK_LITERAL : undefined;
      continue;
    }
    const node = document.createNode(next);
    literalMultiline(node);
    document.set(key, node);
  }
  return document.toString({ lineWidth: 0 });
}

export function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** `settings.yaml` of the level, or `settings.yml` when only that one exists. */
export function settingsFile(paths: ConfigPaths, level: WriteLevel = 'global'): string {
  const directory = resolve(paths[level].directory);
  const yaml = join(directory, `${SETTINGS_NAME}.yaml`);
  const yml = join(directory, `${SETTINGS_NAME}.yml`);
  return !existsSync(yaml) && existsSync(yml) ? yml : yaml;
}

/** Writes a plan: a temporary file next to the target, then a rename; deletion is an unlink. */
export function commitEdit(plan: Extract<EditPlan, { ok: true }>): EditCommitted {
  if (plan.text === null) {
    unlinkSync(plan.file);
    return { file: plan.file, revision: null };
  }
  mkdirSync(dirname(plan.file), { recursive: true });
  const temporary = join(dirname(plan.file), `.${basename(plan.file)}.tmp-${process.pid}`);
  try {
    writeFileSync(temporary, plan.text);
    renameSync(temporary, plan.file);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // nothing was written
    }
    throw error;
  }
  return { file: plan.file, revision: plan.revision };
}
