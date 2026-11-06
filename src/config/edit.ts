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

import { Document, Scalar, isMap, isScalar, parseDocument, visit } from 'yaml';

import {
  ACTIONS_DIR,
  SETTINGS_NAME,
  SPECIALISTS_DIR,
  PIPELINES_DIR,
  LEGACY_PIPELINES_DIR,
  type ConfigPaths,
} from './discover.ts';
import { formatDuration, parseDuration } from './duration.ts';
import { ConfigLoadError, type FieldError } from './errors.ts';
import {
  assembleLevel,
  mergeOrigins,
  levelIsEmpty,
  parseYaml,
  canonicalPipeline,
  readLevel,
  resolveLevels,
  type Level,
  loadRuntimeSettings,
  loadWebSettings,
  type LevelFiles,
} from './load.ts';
import { isMapping, mergeConfigs, type ConfigSource } from './merge.ts';
import {
  CLAUDE_EDIT_MODES,
  CLAUDE_MCP_MODES,
  CLAUDE_SETTINGS_SOURCES,
  DELIVERY_MODES,
  MAX_RANGE,
  MAX_ROUNDS_RANGE,
  OUTSIDE_CHANGES,
  PERMISSIONS,
  RUNTIMES,
  WEB_AUTH_MODES,
  WEB_HOSTS,
  WORKSPACE_BASES,
  SLUG_PATTERN_TEXT,
  isValidSlug,
  defaultRuntimes,
  defaultWeb,
  type ResolvedConfig,
  type RuntimeSettings,
  type Specialist,
  type WebSettings,
} from './model.ts';
import { tagsOf } from './tag-names.ts';
import { validateConfig, validateRuntimesSection, validateWebSection } from './validate.ts';

export type EntryKind = 'specialist' | 'pipeline' | 'action';

const KIND_DIRECTORY: Record<EntryKind, string> = {
  specialist: SPECIALISTS_DIR,
  pipeline: PIPELINES_DIR,
  action: ACTIONS_DIR,
};

/** Key of the section of the configuration tree (`swarm.<section>.<id>`) that holds the kind. */
const KIND_SECTION: Record<EntryKind, 'specialists' | 'pipelines' | 'actions'> = {
  specialist: 'specialists',
  pipeline: 'pipelines',
  action: 'actions',
};

export type EntryLevel = 'project' | 'global' | 'project_over_global';

/** The level a file is written to. */
export type WriteLevel = 'project' | 'global';

/** Thrown for a request that is wrong by itself, before any file is looked at. */
export class ConfigEditError extends Error {}

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
function sameValue(left: unknown, right: unknown): boolean {
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

export interface EntryReference {
  pipeline?: string;
  step?: string;
  split?: boolean;
  /** Id of an action (`actions/<id>.yaml`) that runs the specialist. */
  action?: string;
  /** `delivery.resolver` or `delivery.message_specialist`. */
  field?: string;
  /** Pipeline point (`swarm.stages.<point>` or `stages.<point>` of the pipeline) that names an action. */
  point?: string;
  /** Root of the registry repository the reference comes from; set for shared specialists. */
  repository?: string;
}

/** Everything in a merged `{ swarm }` tree that names the specialist. */
export function specialistReferences(tree: unknown, slug: string): EntryReference[] {
  const swarm = isMapping(tree) && isMapping(tree.swarm) ? tree.swarm : {};
  const references: EntryReference[] = [];
  const pipelines = isMapping(swarm.pipelines) ? swarm.pipelines : {};
  for (const [id, pipeline] of Object.entries(pipelines)) {
    if (!isMapping(pipeline)) continue;
    if (isMapping(pipeline.split) && pipeline.split.specialist === slug) {
      references.push({ pipeline: id, split: true });
    }
    const steps = Array.isArray(pipeline.steps) ? pipeline.steps : [];
    for (const [index, step] of steps.entries()) {
      if (isMapping(step) && step.specialist === slug) {
        references.push({
          pipeline: id,
          step: typeof step.id === 'string' ? step.id : String(index),
        });
      }
    }
  }
  const actions = isMapping(swarm.actions) ? swarm.actions : {};
  for (const [id, action] of Object.entries(actions)) {
    if (isMapping(action) && action.specialist === slug) references.push({ action: id });
  }
  const delivery = isMapping(swarm.delivery) ? swarm.delivery : {};
  for (const field of ['resolver', 'message_specialist']) {
    if (delivery[field] === slug) references.push({ field: `delivery.${field}` });
  }
  return references;
}

/** Everything in a merged `{ swarm }` tree that delegates to the pipeline through `split.pipeline`. */
export function pipelineReferences(tree: unknown, id: string): EntryReference[] {
  const swarm = isMapping(tree) && isMapping(tree.swarm) ? tree.swarm : {};
  const pipelines = isMapping(swarm.pipelines) ? swarm.pipelines : {};
  const references: EntryReference[] = [];
  for (const [name, pipeline] of Object.entries(pipelines)) {
    if (isMapping(pipeline) && isMapping(pipeline.split) && pipeline.split.pipeline === id) {
      references.push({ pipeline: name, split: true });
    }
  }
  return references;
}

/** Everything in a merged `{ swarm }` tree that names the action in a pipeline point. */
export function actionReferences(tree: unknown, id: string): EntryReference[] {
  const swarm = isMapping(tree) && isMapping(tree.swarm) ? tree.swarm : {};
  const references: EntryReference[] = [];
  const scan = (stages: unknown, owner: Partial<EntryReference>): void => {
    if (!isMapping(stages)) return;
    for (const [point, ids] of Object.entries(stages)) {
      if (Array.isArray(ids) && ids.includes(id)) references.push({ ...owner, point });
    }
  };
  scan(swarm.stages, {});
  const pipelines = isMapping(swarm.pipelines) ? swarm.pipelines : {};
  for (const [name, pipeline] of Object.entries(pipelines)) {
    if (isMapping(pipeline)) scan(pipeline.stages, { pipeline: name });
  }
  return references;
}

export interface EditRequest {
  kind: EntryKind;
  id: string;
  /** New content of the file; null deletes it. */
  value: Record<string, unknown> | null;
  /** Revision of the file the caller saw; null when it did not exist. */
  revision: string | null;
  /** Level of the file; `project` when omitted. */
  level?: WriteLevel;
}

export type EditPlan =
  | { ok: true; file: string; text: string | null; revision: string | null }
  | { ok: false; reason: 'invalid'; errors: FieldError[]; references?: EntryReference[] }
  | { ok: false; reason: 'conflict'; message: string };

interface Resolution {
  config: ResolvedConfig | null;
  errors: FieldError[];
}

function resolution(global: Level, project: Level): Resolution {
  try {
    return { config: resolveLevels(global, project).config, errors: [] };
  } catch (error) {
    if (error instanceof ConfigLoadError && error.detail.kind === 'invalid') {
      return { config: null, errors: error.detail.errors };
    }
    throw error;
  }
}

export function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function sourcesOf(files: LevelFiles, kind: EntryKind): ConfigSource[] {
  return files[KIND_SECTION[kind]];
}

export function stemOf(path: string): string {
  return basename(path).replace(/\.ya?ml$/, '');
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

/** Both levels read with broken files reported as problems, so one bad file hides nothing. */
function readLevels(paths: ConfigPaths): { global: LevelFiles; project: LevelFiles } {
  return {
    global: readLevel(paths.global, { tolerant: true }),
    project: readLevel(paths.project, { tolerant: true }),
  };
}

function key(error: FieldError): string {
  return `${error.path}\u0000${error.message}`;
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

function emptyLevel(): Level {
  return assembleLevel({ specialists: [], pipelines: [], actions: [], problems: [] });
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

/**
 * Checks an edit without writing: the revision, then the whole configuration with the file
 * replaced in memory. Only errors the current configuration does not have reject the edit.
 */
export function planEdit(paths: ConfigPaths, request: EditRequest): EditPlan {
  const level = request.level ?? 'project';
  const file = entryFile(paths, request.kind, request.id, level);
  const current = readText(file);
  let edit = request;
  if (edit.kind === 'specialist' && level === 'global' && edit.value !== null) {
    // Shared tags are changed only in the file: a write of the entry keeps them as the file has them.
    let stored: unknown;
    try {
      const parsed = current === undefined ? undefined : parseYaml(current, file);
      stored = isMapping(parsed) ? parsed.tags : undefined;
    } catch {
      stored = undefined;
    }
    const { tags, ...rest } = edit.value;
    if ('tags' in edit.value && !sameValue(tags, stored)) {
      return {
        ok: false,
        reason: 'invalid',
        errors: [
          {
            file,
            path: `swarm.specialists.${edit.id}.tags`,
            message: 'shared tags are changed only in the file',
          },
        ],
      };
    }
    edit = { ...edit, value: stored === undefined ? rest : { ...rest, tags: stored } };
  }
  if (revisionOf(current) !== edit.revision) {
    return {
      ok: false,
      reason: 'conflict',
      message:
        current === undefined
          ? `${file} does not exist any more`
          : edit.revision === null
            ? `${file} already exists`
            : `${file} was changed after it was read`,
    };
  }
  let draft: Draft;
  try {
    draft = buildDraft(paths, edit, current);
  } catch (error) {
    if (!(error instanceof ConfigEditError)) throw error;
    return {
      ok: false,
      reason: 'invalid',
      errors: [
        { file, path: `swarm.${KIND_SECTION[edit.kind]}.${edit.id}`, message: error.message },
      ],
    };
  }
  if (edit.value === null && (edit.kind === 'specialist' || edit.kind === 'action')) {
    const kind = edit.kind;
    const referencesTo = kind === 'specialist' ? specialistReferences : actionReferences;
    const inGlobal = sourcesOf(draft.files.global, kind).some(
      (source) => stemOf(source.path) === edit.id,
    );
    const inProject = sourcesOf(draft.files.project, kind).some(
      (source) => stemOf(source.path) === edit.id,
    );
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
      if (!inProject) add(referencesTo(mergeConfigs(globalTree, projectTree), edit.id));
    } else if (!inGlobal) {
      add(referencesTo(mergeConfigs(globalTree, projectTree), edit.id));
    }
    if (references.length > 0) return { ok: false, reason: 'invalid', errors: [], references };
  }
  const known = new Set(draft.before.errors.map(key));
  const added = draft.after.errors.filter((error) => !known.has(key(error)));
  if (added.length > 0) return { ok: false, reason: 'invalid', errors: added };
  return { ok: true, file, text: draft.text, revision: revisionOf(draft.text ?? undefined) };
}

export type SettingKind =
  'boolean' | 'choice' | 'integer' | 'string' | 'duration' | 'strings' | 'specialist' | 'env';

/** A value the editor writes into settings.yaml; null removes the field. */
export type SettingValue = boolean | number | string | string[] | null;

/** One field of settings.yaml the editor may write. */
export interface SettingField {
  /** Key path in settings.yaml, such as `delivery.mode`. */
  path: string;
  kind: SettingKind;
  /** Allowed values of a `choice`. */
  options?: readonly string[];
  /** Inclusive bounds of an `integer`. */
  range?: readonly [number, number];
  /** Read only from the shared settings.yaml (`web.*`, `runtimes.*`). */
  globalOnly: boolean;
}

const WEB_PORT_RANGE = [1, 65535] as const;
const RESOLVER_ROUNDS_RANGE = MAX_ROUNDS_RANGE;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function field(
  path: string,
  kind: SettingKind,
  extra: {
    options?: readonly string[];
    range?: readonly [number, number];
    globalOnly?: boolean;
  } = {},
): SettingField {
  return { path, kind, ...extra, globalOnly: extra.globalOnly ?? false };
}

/** Every field of settings.yaml the editor writes, in the order the editor shows them. */
export const SETTING_FIELDS: readonly SettingField[] = [
  field('max', 'integer', { range: MAX_RANGE }),
  field('workspace_dir', 'string'),
  field('outside_changes', 'choice', { options: OUTSIDE_CHANGES }),
  field('defaults.runtime', 'choice', { options: RUNTIMES }),
  field('defaults.permissions', 'choice', { options: PERMISSIONS }),
  field('defaults.timeout', 'duration'),
  field('defaults.allow_commands', 'strings'),
  field('defaults.tools', 'strings'),
  field('claude.edit_mode', 'choice', { options: CLAUDE_EDIT_MODES }),
  field('claude.mcp', 'choice', { options: CLAUDE_MCP_MODES }),
  field('claude.settings', 'choice', { options: CLAUDE_SETTINGS_SOURCES }),
  field('delivery.mode', 'choice', { options: DELIVERY_MODES }),
  field('delivery.auto', 'boolean'),
  field('delivery.keep', 'boolean'),
  field('delivery.commit_message', 'string'),
  field('delivery.message_specialist', 'specialist'),
  field('delivery.resolver', 'specialist'),
  field('delivery.resolver_rounds', 'integer', { range: RESOLVER_ROUNDS_RANGE }),
  field('delivery.message_prompt', 'string'),
  field('delivery.resolver_prompt', 'string'),
  field('workspace.base', 'choice', { options: WORKSPACE_BASES }),
  field('workspace.include', 'strings'),
  field('naming.enabled', 'boolean'),
  field('naming.runtime', 'choice', { options: RUNTIMES }),
  field('naming.model', 'string'),
  field('web.autostart', 'boolean', { globalOnly: true }),
  field('web.auth', 'choice', { options: WEB_AUTH_MODES, globalOnly: true }),
  field('web.host', 'choice', { options: WEB_HOSTS, globalOnly: true }),
  field('web.port', 'integer', { range: WEB_PORT_RANGE, globalOnly: true }),
  ...RUNTIMES.flatMap((runtime) => [
    field(`runtimes.${runtime}.command`, 'string', { globalOnly: true }),
    field(`runtimes.${runtime}.args`, 'strings', { globalOnly: true }),
    field(`runtimes.${runtime}.env`, 'env', { globalOnly: true }),
  ]),
];

const ENV_VARIABLE_PATH = /^runtimes\.([a-z]+)\.env\.(.+)$/;

/** The field for a path, also a single variable `runtimes.<runtime>.env.<NAME>`; undefined for any other path. */
export function settingFieldOf(path: string): SettingField | undefined {
  const known = SETTING_FIELDS.find((candidate) => candidate.path === path);
  if (known) return known;
  const match = ENV_VARIABLE_PATH.exec(path);
  if (
    match &&
    (RUNTIMES as readonly string[]).includes(match[1] as string) &&
    ENV_NAME.test(match[2] as string)
  ) {
    return field(path, 'env', { globalOnly: true });
  }
  return undefined;
}

/** A variable of `runtimes.<runtime>.env` (a string), as opposed to the whole `env` section. */
function isEnvVariable(path: string): boolean {
  return ENV_VARIABLE_PATH.test(path);
}

export interface SettingRequest {
  path: string;
  /** New value; null removes the field. */
  value: SettingValue;
  /** Revision of settings.yaml the caller saw; null when it did not exist. */
  revision: string | null;
  level?: WriteLevel;
}

/** `settings.yaml` of the level, or `settings.yml` when only that one exists. */
export function settingsFile(paths: ConfigPaths, level: WriteLevel = 'global'): string {
  const directory = resolve(paths[level].directory);
  const yaml = join(directory, `${SETTINGS_NAME}.yaml`);
  const yml = join(directory, `${SETTINGS_NAME}.yml`);
  return !existsSync(yaml) && existsSync(yml) ? yml : yaml;
}

/** Text of settings.yaml with one field set (or removed); comments and other keys survive. */
export function editSetting(text: string | undefined, path: string, value: SettingValue): string {
  const keys = path.split('.');
  if (text === undefined || text.trim() === '') {
    if (value === null) return text ?? '';
    const fresh = new Document({});
    fresh.setIn(keys, value);
    return `${text ?? ''}${fresh.toString({ lineWidth: 0 })}`;
  }
  const document = parseDocument(text, { merge: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new ConfigEditError(`the file has a syntax error: ${document.errors[0]?.message ?? ''}`);
  }
  if (!isMap(document.contents)) {
    if (
      document.contents !== null &&
      !(isScalar(document.contents) && document.contents.value === null)
    ) {
      throw new ConfigEditError('the file must contain a mapping');
    }
    document.contents = document.createNode({}) as never;
  }
  if (value === null) {
    document.deleteIn(keys);
    const parent = document.getIn(keys.slice(0, -1), true);
    if (keys.length > 1 && isMap(parent) && parent.items.length === 0) {
      document.deleteIn(keys.slice(0, -1));
    }
  } else {
    document.setIn(keys, value);
  }
  return document.toString({ lineWidth: 0 });
}

function textError(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be a string';
  return value.trim() === '' ? 'must not be empty' : null;
}

/** Why the value does not fit the field: the message and the path suffix (`[1]` for a list item), or null. */
function settingTypeError(
  setting: SettingField,
  value: SettingValue,
): { message: string; suffix: string } | null {
  if (value === null) return null;
  const fail = (message: string, suffix = '') => ({ message, suffix });
  switch (setting.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? null : fail('must be true or false');
    case 'choice': {
      const options = setting.options ?? [];
      const message = textError(value);
      if (message !== null) return fail(message);
      return options.includes(value as string)
        ? null
        : fail(`must be one of ${options.join(', ')}`);
    }
    case 'integer': {
      const [low, high] = setting.range ?? [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
      return typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high
        ? null
        : fail(`must be an integer from ${low} to ${high}`);
    }
    case 'duration': {
      const message = textError(value);
      if (message !== null) return fail(message);
      return parseDuration(value as string) === null
        ? fail('must be a positive duration such as 90s, 30m or 2h')
        : null;
    }
    case 'strings': {
      if (!Array.isArray(value)) return fail('must be a list of strings');
      for (const [index, item] of value.entries()) {
        const message = textError(item);
        if (message !== null) return fail(message, `[${index}]`);
      }
      return null;
    }
    case 'env':
      if (!isEnvVariable(setting.path)) return fail('cannot be written as a whole');
      return typeof value === 'string' ? null : fail('must be a string');
    case 'string':
    case 'specialist': {
      const message = textError(value);
      return message === null ? null : fail(message);
    }
  }
}

export interface SettingsRequest {
  /** New values by path; null removes the field. */
  values: Record<string, SettingValue>;
  /** Revision of settings.yaml the caller saw; null when it did not exist. */
  revision: string | null;
  level?: WriteLevel;
}

/**
 * Checks a write of several settings without writing: the types of all values, the revision, then
 * the whole configuration with all of the edits applied to one text.
 */
export function planSettings(paths: ConfigPaths, request: SettingsRequest): EditPlan {
  const level = request.level ?? 'global';
  const entries = Object.entries(request.values);
  if (entries.length === 0) throw new ConfigEditError('there is nothing to write');
  const unknown = entries.filter(([path]) => settingFieldOf(path) === undefined).map(([p]) => p);
  if (unknown.length > 0) {
    throw new ConfigEditError(
      `${unknown.map((path) => `\`${path}\``).join(', ')} cannot be written; allowed: ${SETTING_FIELDS.map((setting) => setting.path).join(', ')}`,
    );
  }
  const file = settingsFile(paths, level);
  const typeErrors: FieldError[] = [];
  for (const [path, value] of entries) {
    const setting = settingFieldOf(path) as SettingField;
    if (setting.globalOnly && level === 'project') {
      typeErrors.push({
        file,
        path: `swarm.${path}`,
        message: 'is read only from the shared settings.yaml',
      });
      continue;
    }
    const problem = settingTypeError(setting, value);
    if (problem !== null) {
      typeErrors.push({ file, path: `swarm.${path}${problem.suffix}`, message: problem.message });
    }
  }
  if (typeErrors.length > 0) return { ok: false, reason: 'invalid', errors: typeErrors };
  const current = readText(file);
  if (revisionOf(current) !== request.revision) {
    return {
      ok: false,
      reason: 'conflict',
      message:
        current === undefined
          ? `${file} does not exist any more`
          : request.revision === null
            ? `${file} already exists`
            : `${file} was changed after it was read`,
    };
  }
  let text = current;
  try {
    for (const [path, value] of entries) text = editSetting(text, path, value);
  } catch (error) {
    if (!(error instanceof ConfigEditError)) throw error;
    return {
      ok: false,
      reason: 'invalid',
      errors: [{ file, path: `swarm.${entries[0]?.[0] ?? ''}`, message: error.message }],
    };
  }
  const written = text ?? '';
  const files = readLevels(paths);
  const before = resolution(assembleLevel(files.global), assembleLevel(files.project));
  const settings: ConfigSource = { path: file, value: parseYaml(written, file), text: written };
  const drafted = { ...files, [level]: { ...files[level], settings } };
  const after = resolution(assembleLevel(drafted.global), assembleLevel(drafted.project));
  const known = new Set(before.errors.map(key));
  const added = after.errors.filter((error) => !known.has(key(error)));
  if (
    level === 'global' &&
    entries.some(([path]) => (settingFieldOf(path) as SettingField).globalOnly)
  ) {
    const sectionErrors = (source: ConfigSource | undefined): FieldError[] => {
      const root = isMapping(source?.value) ? source.value : {};
      return [
        ...validateWebSection(root.web).errors,
        ...validateRuntimesSection(root.runtimes).errors,
      ];
    };
    const sectionKnown = new Set(sectionErrors(files.global.settings).map(key));
    const seen = new Set([...known, ...added.map(key)]);
    for (const error of sectionErrors(settings)) {
      if (sectionKnown.has(key(error)) || seen.has(key(error))) continue;
      added.push({ ...error, file });
    }
  }
  if (added.length > 0) return { ok: false, reason: 'invalid', errors: added };
  return { ok: true, file, text: written, revision: revisionOf(written) };
}

/** Checks a write of one setting without writing: the revision, then the whole configuration. */
export function planSetting(paths: ConfigPaths, request: SettingRequest): EditPlan {
  return planSettings(paths, {
    values: { [request.path]: request.value },
    revision: request.revision,
    ...(request.level ? { level: request.level } : {}),
  });
}

export interface EditCommitted {
  file: string;
  revision: string | null;
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

/** One file of an entry on one level. */
export interface EntrySource {
  file: string;
  revision: string;
  raw: Record<string, unknown>;
}

export type EntrySources = { project?: EntrySource; global?: EntrySource };

function sourceOf(source: ConfigSource | undefined): EntrySource | undefined {
  if (!source) return undefined;
  return {
    file: source.path,
    revision: revisionOf(source.text) ?? '',
    raw: rawOf(source),
  };
}

function sourcesFor(project?: ConfigSource, global?: ConfigSource): EntrySources {
  const result: EntrySources = {};
  const p = sourceOf(project);
  const g = sourceOf(global);
  if (p) result.project = p;
  if (g) result.global = g;
  return result;
}

/** A specialist in the editor: where it lives and what its files say. */
export interface EditorSpecialist {
  slug: string;
  level: EntryLevel;
  /** The file that applies: the project one when there is one. */
  file: string;
  /** Revision of the project file; null when the specialist has none in the project. */
  revision: string | null;
  /** Values as the applying file has them. */
  raw: Record<string, unknown>;
  /** The file of each level the specialist has. */
  sources: EntrySources;
  /** Values after defaults; null when the specialist does not pass validation. */
  effective: EditorSpecialistValues | null;
  /** Tags of the shared file (read only here); empty when it has none or they are not valid. */
  shared_tags: string[];
  /** Tags of the project file. */
  own_tags: string[];
}

export interface EditorSpecialistValues {
  name: string;
  runtime: string;
  model: string | null;
  permissions: string;
  timeout: string;
  allow_commands: string[];
  tools: string[];
  skills: string[];
  prompt: string | null;
  max: number | null;
}

/** A pipeline in the editor: where it lives and what its files say. */
export interface EditorPipeline {
  id: string;
  level: EntryLevel;
  file: string;
  revision: string | null;
  raw: Record<string, unknown>;
  sources: EntrySources;
  /** Tags of the shared file; empty when it has none or they are not valid. */
  shared_tags: string[];
  /** Tags of the project file. */
  own_tags: string[];
}

/** An action in the editor: where it lives and what its files say. */
export interface EditorAction {
  id: string;
  level: EntryLevel;
  file: string;
  revision: string | null;
  raw: Record<string, unknown>;
  sources: EntrySources;
}

export interface EditorSetting {
  /** Key path in settings.yaml, such as `delivery.mode`. */
  path: string;
  value: unknown;
  /** File the value comes from; null for a built-in default. */
  file: string | null;
  kind: SettingKind;
  options?: readonly string[];
  range?: readonly [number, number];
  /** Read only from the shared settings.yaml. */
  globalOnly: boolean;
  /** The built-in default. */
  defaultValue: unknown;
  /** The value of the global level alone, without the project. */
  globalValue: unknown;
  /** What each settings.yaml says itself; a key that is not there is absent. For `env`, only names. */
  written: { global?: unknown; project?: unknown };
}

export interface SettingsFileView {
  file: string;
  /** Revision of the file; null when it does not exist. */
  revision: string | null;
}

export interface ConfigEditorView {
  directories: { global: string; project: string };
  settingsFiles: { global: SettingsFileView; project: SettingsFileView };
  specialists: EditorSpecialist[];
  pipelines: EditorPipeline[];
  actions: EditorAction[];
  settings: EditorSetting[];
  errors: FieldError[];
}

function valuesOf(specialist: Specialist): EditorSpecialistValues {
  return {
    name: specialist.name,
    runtime: specialist.runtime,
    model: specialist.model,
    permissions: specialist.permissions,
    timeout: formatDuration(specialist.timeoutSeconds),
    allow_commands: specialist.allowCommands,
    tools: specialist.tools,
    skills: specialist.skills,
    prompt: specialist.prompt,
    max: specialist.max,
  };
}

function settingsOf(config: ResolvedConfig): [string, unknown][] {
  return [
    ['max', config.max],
    ['workspace_dir', config.workspaceDir],
    ['outside_changes', config.outsideChanges],
    ['defaults.runtime', config.defaults.runtime],
    ['defaults.permissions', config.defaults.permissions],
    ['defaults.timeout', formatDuration(config.defaults.timeoutSeconds)],
    ['defaults.allow_commands', config.defaults.allowCommands],
    ['defaults.tools', config.defaults.tools],
    ['claude.edit_mode', config.claude.editMode],
    ['claude.mcp', config.claude.mcp],
    ['claude.settings', config.claude.settings],
    ['delivery.mode', config.delivery.mode],
    ['delivery.auto', config.delivery.auto],
    ['delivery.keep', config.delivery.keep],
    ['delivery.commit_message', config.delivery.commitMessage],
    ['delivery.message_specialist', config.delivery.messageSpecialist],
    ['delivery.resolver', config.delivery.resolver],
    ['delivery.resolver_rounds', config.delivery.resolverRounds],
    ['delivery.message_prompt', config.delivery.messagePrompt ?? null],
    ['delivery.resolver_prompt', config.delivery.resolverPrompt ?? null],
    ['workspace.base', config.workspace.base],
    ['workspace.include', config.workspace.include],
    ['naming.enabled', config.naming.enabled],
    ['naming.runtime', config.naming.runtime],
    ['naming.model', config.naming.model],
  ];
}

/**
 * `web.*` and `runtimes.*` as the daemon reads them: from the global settings.yaml only. The value
 * of `env` never leaves the config layer: only the sorted names of the variables do.
 */
function globalSectionSettings(
  paths: ConfigPaths,
  global: LevelFiles,
): { path: string; value: unknown; file: string | null }[] {
  const file = global.settings?.path ?? null;
  const root = isMapping(global.settings?.value) ? global.settings.value : {};
  const has = (section: string, ...keys: string[]): boolean => {
    let node: unknown = root[section];
    for (const key of keys) {
      if (!isMapping(node) || !(key in node)) return false;
      node = node[key];
    }
    return true;
  };
  const originOf = (section: string, ...keys: string[]) => (has(section, ...keys) ? file : null);
  const safe = <T>(read: () => T, fallback: () => T): T => {
    try {
      return read();
    } catch (error) {
      if (error instanceof ConfigLoadError) return fallback();
      throw error;
    }
  };
  const web = safe(() => loadWebSettings(paths), defaultWeb);
  const runtimes = safe(() => loadRuntimeSettings(paths), defaultRuntimes);
  return sectionValues(web, runtimes).map(([path, value]) => ({
    path,
    value,
    file: originOf(...(path.split('.') as [string, ...string[]])),
  }));
}

/** `web.*` and `runtimes.*` values as pairs; the value of `env` is reduced to the sorted names. */
function sectionValues(web: WebSettings, runtimes: RuntimeSettings): [string, unknown][] {
  const result: [string, unknown][] = [
    ['web.autostart', web.autostart],
    ['web.auth', web.auth],
    ['web.host', web.host],
    ['web.port', web.port],
  ];
  for (const runtime of RUNTIMES) {
    const command = runtimes[runtime];
    result.push(
      [`runtimes.${runtime}.command`, command.command],
      [`runtimes.${runtime}.args`, command.args],
      [`runtimes.${runtime}.env`, Object.keys(command.env).sort()],
    );
  }
  return result;
}

/** Settings that are not valid are shown with the defaults, the errors say what is wrong. */
function configOrDefaults(config: ResolvedConfig | null): ResolvedConfig {
  if (config) return config;
  const result = validateConfig({ swarm: {} });
  if (!result.ok) throw new Error('the empty configuration must be valid');
  return result.config;
}

function rawOf(source: ConfigSource | undefined): Record<string, unknown> {
  return isMapping(source?.value) ? source.value : {};
}

/** Everything the specialists tab shows, also when the configuration does not pass validation. */
export function editorView(paths: ConfigPaths): ConfigEditorView {
  const files = readLevels(paths);
  const global = assembleLevel(files.global);
  const project = assembleLevel(files.project);
  const { config, errors } = resolution(global, project);
  const byStem = (sources: ConfigSource[]) =>
    new Map(sources.map((source) => [stemOf(source.path), source]));
  const globalSpecialists = byStem(files.global.specialists);
  const projectSpecialists = byStem(files.project.specialists);
  const merged = mergeConfigs(global.tree, project.tree);
  const swarm = isMapping(merged) && isMapping(merged.swarm) ? merged.swarm : {};
  const defaults = isMapping(swarm.defaults) ? swarm.defaults : {};
  const slugs = [...new Set([...globalSpecialists.keys(), ...projectSpecialists.keys()])].sort();
  const specialists = slugs.map((slug): EditorSpecialist => {
    const inProject = projectSpecialists.get(slug);
    const inGlobal = globalSpecialists.get(slug);
    const source = (inProject ?? inGlobal) as ConfigSource;
    const level: EntryLevel = inProject ? (inGlobal ? 'project_over_global' : 'project') : 'global';
    let effective: EditorSpecialistValues | null = null;
    const resolved = config?.specialists.find((candidate) => candidate.slug === slug);
    if (resolved) effective = valuesOf(resolved);
    else {
      const alone = validateConfig({
        swarm: { defaults, specialists: { [slug]: source.value ?? null } },
      });
      const found = alone.ok ? alone.config.specialists[0] : undefined;
      if (found) effective = valuesOf(found);
    }
    return {
      slug,
      level,
      file: source.path,
      revision: inProject ? revisionOf(inProject.text) : null,
      raw: rawOf(source),
      sources: sourcesFor(inProject, inGlobal),
      effective,
      shared_tags: tagsOf(rawOf(inGlobal)),
      own_tags: tagsOf(rawOf(inProject)),
    };
  });
  const globalPipelines = byStem(files.global.pipelines);
  const projectPipelines = byStem(files.project.pipelines);
  const pipelines = [...new Set([...globalPipelines.keys(), ...projectPipelines.keys()])]
    .sort()
    .map((id): EditorPipeline => {
      const inProject = projectPipelines.get(id);
      const inGlobal = globalPipelines.get(id);
      const source = (inProject ?? inGlobal) as ConfigSource;
      return {
        id,
        level: inProject ? (inGlobal ? 'project_over_global' : 'project') : 'global',
        file: source.path,
        revision: inProject ? revisionOf(inProject.text) : null,
        raw: rawOf(source),
        sources: sourcesFor(inProject, inGlobal),
        shared_tags: tagsOf(rawOf(inGlobal)),
        own_tags: tagsOf(rawOf(inProject)),
      };
    });
  const globalActions = byStem(files.global.actions);
  const projectActions = byStem(files.project.actions);
  const actions = [...new Set([...globalActions.keys(), ...projectActions.keys()])]
    .sort()
    .map((id): EditorAction => {
      const inProject = projectActions.get(id);
      const inGlobal = globalActions.get(id);
      const source = (inProject ?? inGlobal) as ConfigSource;
      return {
        id,
        level: inProject ? (inGlobal ? 'project_over_global' : 'project') : 'global',
        file: source.path,
        revision: inProject ? revisionOf(inProject.text) : null,
        raw: rawOf(source),
        sources: sourcesFor(inProject, inGlobal),
      };
    });
  const origins = mergeOrigins(global, project);
  const base = [
    ...settingsOf(configOrDefaults(config)).map(([path, value]) => ({
      path,
      value,
      file: origins.get(`swarm.${path}`) ?? null,
    })),
    ...globalSectionSettings(paths, files.global),
  ];
  const defaultValues = new Map<string, unknown>([
    ...settingsOf(configOrDefaults(null)),
    ...sectionValues(defaultWeb(), defaultRuntimes()),
  ]);
  const aloneConfig = resolution(global, emptyLevel()).config;
  const globalValues = new Map<string, unknown>(settingsOf(configOrDefaults(aloneConfig)));
  const writtenOf = (source: ConfigSource | undefined, path: string, kind: SettingKind) => {
    let node: unknown = source?.value;
    for (const part of path.split('.')) {
      if (!isMapping(node) || !(part in node)) return undefined;
      node = node[part];
    }
    return kind === 'env' && isMapping(node) ? Object.keys(node).sort() : node;
  };
  const settings: EditorSetting[] = base.map((entry) => {
    const setting = settingFieldOf(entry.path) as SettingField;
    const written: EditorSetting['written'] = {};
    const inGlobal = writtenOf(files.global.settings, entry.path, setting.kind);
    const inProject = setting.globalOnly
      ? undefined
      : writtenOf(files.project.settings, entry.path, setting.kind);
    if (inGlobal !== undefined) written.global = inGlobal;
    if (inProject !== undefined) written.project = inProject;
    return {
      ...entry,
      kind: setting.kind,
      ...(setting.options ? { options: setting.options } : {}),
      ...(setting.range ? { range: setting.range } : {}),
      globalOnly: setting.globalOnly,
      defaultValue: defaultValues.get(entry.path),
      globalValue: setting.globalOnly ? entry.value : globalValues.get(entry.path),
      written,
    };
  });
  const settingsView = (level: WriteLevel): SettingsFileView => ({
    file: settingsFile(paths, level),
    revision: revisionOf(files[level].settings?.text),
  });
  return {
    directories: { global: paths.global.directory, project: paths.project.directory },
    settingsFiles: { global: settingsView('global'), project: settingsView('project') },
    specialists,
    pipelines,
    actions,
    settings,
    errors,
  };
}
