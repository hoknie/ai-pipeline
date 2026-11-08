import { key } from '../types/editor.ts';
import {
  assembleLevel,
  canonicalPipeline,
  levelIsEmpty,
  parseYaml,
} from '../../swarm-config/services/index.ts';
import {
  ConfigLoadError,
  type ConfigPaths,
  type ConfigSource,
  type FieldError,
  isMapping,
  type LevelFiles,
  mergeConfigs,
  type ResolvedConfig,
} from '../../swarm-config/types/index.ts';
import {
  editDocument,
  entryFile,
  readText,
  revisionOf,
  sameValue,
} from '../repositories/documents.ts';
import { emptyLevel, readLevels, resolution, type Resolution } from './levels.ts';
import { actionReferences, chainReferences, specialistReferences, stemOf } from './references.ts';
import {
  ConfigEditError,
  type EditPlan,
  type EditRequest,
  type WriteLevel,
  type EntryKind,
  type EntryReference,
  KIND_SECTION,
} from '../types/editor.ts';

function sourcesOf(files: LevelFiles, kind: EntryKind): ConfigSource[] {
  return files[KIND_SECTION[kind]];
}

function withEntry(
  files: LevelFiles,
  kind: EntryKind,
  id: string,
  file: string,
  text: string | null,
): LevelFiles {
  const others = sourcesOf(files, kind).filter((source) => stemOf(source.path) !== id);
  const parsed = text === null ? null : parseYaml(text, file);
  const value = kind === 'pipeline' ? canonicalPipeline(parsed) : parsed;
  const list = text === null ? others : [...others, { path: file, value, text }];
  list.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { ...files, [KIND_SECTION[kind]]: list };
}

interface Draft {
  file: string;
  text: string | null;
  before: Resolution;
  after: Resolution;
  files: { global: LevelFiles; project: LevelFiles };
}

/** The configuration with the edit applied in memory; nothing is read twice or written. */
function buildDraft(paths: ConfigPaths, edit: EditRequest, current: string | undefined): Draft {
  const level = edit.level ?? 'project';
  const file = entryFile(paths, edit.kind, edit.id, level);
  const text = edit.value === null ? null : editDocument(current, edit.value);
  const files = readLevels(paths);
  const drafted = withEntry(files[level], edit.kind, edit.id, file, text);
  const draftFiles = { ...files, [level]: drafted };
  const before = resolution(assembleLevel(files.global), assembleLevel(files.project));
  const after = resolution(assembleLevel(draftFiles.global), assembleLevel(draftFiles.project));
  if (level === 'global') {
    // The global level has to work in any repository, so it is also checked on its own.
    const alone = (global: LevelFiles) =>
      levelIsEmpty(global)
        ? { config: null, errors: [] }
        : resolution(assembleLevel(global), emptyLevel());
    const aloneBefore = alone(files.global);
    const aloneAfter = alone(drafted);
    const known = new Set(aloneBefore.errors.map(key));
    const extra = aloneAfter.errors.filter((error) => !known.has(key(error)));
    const seen = new Set(after.errors.map(key));
    const merged = [...after.errors, ...extra.filter((error) => !seen.has(key(error)))];
    return {
      file,
      text,
      before: {
        config: before.config,
        errors: [
          ...before.errors,
          ...aloneBefore.errors.filter(
            (error) => !before.errors.some((e) => key(e) === key(error)),
          ),
        ],
      },
      after: { config: after.config, errors: merged },
      files,
    };
  }
  return { file, text, before, after, files };
}

/**
 * The configuration as it would be with the edit, without the revision check and without
 * writing: the resolved configuration (null when it has errors) and all of its errors.
 */
export function draftConfig(
  paths: ConfigPaths,
  edit: Pick<EditRequest, 'kind' | 'id' | 'value' | 'level'>,
): { config: ResolvedConfig | null; errors: FieldError[] } {
  const level = edit.level ?? 'project';
  const file = entryFile(paths, edit.kind, edit.id, level);
  try {
    const draft = buildDraft(paths, { ...edit, revision: null }, readText(file));
    if (level === 'global' && edit.value !== null) {
      // The graph of a global draft is built from the global level alone, so a project file
      // with the same id cannot hide the draft.
      const files = readLevels(paths);
      const drafted = withEntry(files.global, edit.kind, edit.id, file, draft.text);
      const alone = resolution(assembleLevel(drafted), emptyLevel());
      const seen = new Set(draft.after.errors.map(key));
      return {
        config: alone.config ?? draft.after.config,
        errors: [...draft.after.errors, ...alone.errors.filter((error) => !seen.has(key(error)))],
      };
    }
    return draft.after;
  } catch (error) {
    if (!(error instanceof ConfigEditError)) throw error;
    return {
      config: null,
      errors: [
        { file, path: `swarm.${KIND_SECTION[edit.kind]}.${edit.id}`, message: error.message },
      ],
    };
  }
}

/**
 * New errors of the configuration when several files of the project level are added or replaced
 * at once, without writing: the errors the current configuration does not have.
 */
export function draftProjectFiles(
  paths: ConfigPaths,
  entries: { kind: EntryKind; id: string; file: string; text: string }[],
): FieldError[] {
  const files = readLevels(paths);
  let drafted = files.project;
  try {
    for (const entry of entries) {
      drafted = withEntry(drafted, entry.kind, entry.id, entry.file, entry.text);
    }
  } catch (error) {
    if (!(error instanceof ConfigLoadError)) throw error;
    const first = entries.find((entry) => error.message.includes(entry.file)) ?? entries[0];
    return [
      {
        file: first?.file ?? '',
        path: `swarm.${KIND_SECTION[first?.kind ?? 'specialist']}.${first?.id ?? ''}`,
        message: error.message,
      },
    ];
  }
  const before = resolution(assembleLevel(files.global), assembleLevel(files.project));
  const after = resolution(assembleLevel(files.global), assembleLevel(drafted));
  const known = new Set(before.errors.map(key));
  return after.errors.filter((error) => !known.has(key(error)));
}

type TagGuard = { request: EditRequest } | { rejected: EditPlan };

/** Shared tags are changed only in the file: a write of the entry keeps them as the file has them. */
function keepSharedTags(request: EditRequest, file: string, current: string | undefined): TagGuard {
  if (request.kind !== 'specialist' || request.level !== 'global' || request.value === null) {
    return { request };
  }
  let stored: unknown;
  try {
    const parsed = current === undefined ? undefined : parseYaml(current, file);
    stored = isMapping(parsed) ? parsed.tags : undefined;
  } catch {
    stored = undefined;
  }
  const { tags, ...rest } = request.value;
  if ('tags' in request.value && !sameValue(tags, stored)) {
    const message = 'shared tags are changed only in the file';
    const path = `swarm.specialists.${request.id}.tags`;
    return { rejected: { ok: false, reason: 'invalid', errors: [{ file, path, message }] } };
  }
  return {
    request: { ...request, value: stored === undefined ? rest : { ...rest, tags: stored } },
  };
}

/** Entries that still name a removed specialist, chain or action, or none. */
function referencesOfRemoved(draft: Draft, edit: EditRequest, level: WriteLevel) {
  const referencesTo =
    edit.kind === 'specialist'
      ? specialistReferences
      : edit.kind === 'chain'
        ? chainReferences
        : actionReferences;
  const has = (files: LevelFiles) =>
    sourcesOf(files, edit.kind).some((source) => stemOf(source.path) === edit.id);
  const globalTree = assembleLevel(draft.files.global).tree;
  const projectTree = assembleLevel(draft.files.project).tree;
  const references: EntryReference[] = [];
  const add = (found: EntryReference[]) => {
    for (const reference of found) {
      if (!references.some((known) => JSON.stringify(known) === JSON.stringify(reference))) {
        references.push(reference);
      }
    }
  };
  if (level === 'global') {
    add(referencesTo(globalTree, edit.id));
    if (!has(draft.files.project))
      add(referencesTo(mergeConfigs(globalTree, projectTree), edit.id));
  } else if (!has(draft.files.global)) {
    add(referencesTo(mergeConfigs(globalTree, projectTree), edit.id));
  }
  return references;
}

function conflictOf(file: string, current: string | undefined, revision: string | null): EditPlan {
  return {
    ok: false,
    reason: 'conflict',
    message:
      current === undefined
        ? `${file} does not exist any more`
        : revision === null
          ? `${file} already exists`
          : `${file} was changed after it was read`,
  };
}

/**
 * Checks an edit without writing: the revision, then the whole configuration with the file
 * replaced in memory. Only errors the current configuration does not have reject the edit.
 */
export function planEdit(paths: ConfigPaths, request: EditRequest): EditPlan {
  const level = request.level ?? 'project';
  const file = entryFile(paths, request.kind, request.id, level);
  const current = readText(file);
  const guard = keepSharedTags({ ...request, level }, file, current);
  if ('rejected' in guard) return guard.rejected;
  const edit = guard.request;
  if (revisionOf(current) !== edit.revision) return conflictOf(file, current, edit.revision);
  let draft: Draft;
  try {
    draft = buildDraft(paths, edit, current);
  } catch (error) {
    if (!(error instanceof ConfigEditError)) throw error;
    const path = `swarm.${KIND_SECTION[edit.kind]}.${edit.id}`;
    return { ok: false, reason: 'invalid', errors: [{ file, path, message: error.message }] };
  }
  if (
    edit.value === null &&
    (edit.kind === 'specialist' || edit.kind === 'action' || edit.kind === 'chain')
  ) {
    const references = referencesOfRemoved(draft, edit, level);
    if (references.length > 0) return { ok: false, reason: 'invalid', errors: [], references };
  }
  const known = new Set(draft.before.errors.map(key));
  const added = draft.after.errors.filter((error) => !known.has(key(error)));
  if (added.length > 0) return { ok: false, reason: 'invalid', errors: added };
  return { ok: true, file, text: draft.text, revision: revisionOf(draft.text ?? undefined) };
}
