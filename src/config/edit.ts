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

import { SETTINGS_NAME, SPECIALISTS_DIR, WORKFLOWS_DIR, type ConfigPaths } from './discover.ts';
import { formatDuration } from './duration.ts';
import { ConfigLoadError, type FieldError } from './errors.ts';
import {
  assembleLevel,
  mergeOrigins,
  levelIsEmpty,
  parseYaml,
  readLevel,
  resolveLevels,
  type Level,
  type LevelFiles,
} from './load.ts';
import { isMapping, mergeConfigs, type ConfigSource } from './merge.ts';
import { SLUG_PATTERN_TEXT, isValidSlug, type ResolvedConfig, type Specialist } from './model.ts';
import { validateConfig } from './validate.ts';

export type EntryKind = 'specialist' | 'workflow';

const KIND_DIRECTORY: Record<EntryKind, string> = {
  specialist: SPECIALISTS_DIR,
  workflow: WORKFLOWS_DIR,
};

/** Key of the section of the configuration tree (`swarm.<section>.<id>`) that holds the kind. */
const KIND_SECTION: Record<EntryKind, 'specialists' | 'workflows'> = {
  specialist: 'specialists',
  workflow: 'workflows',
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
 * The file of an entry on a level: `specialists/<id>.yaml` (`workflows/<id>.yaml`) in the directory of the level, or the
 * `.yml` file when that one exists. The id must be a slug, so the path cannot leave the directory of the kind.
 */
export function entryFile(
  paths: ConfigPaths,
  kind: EntryKind,
  id: string,
  level: WriteLevel = 'project',
): string {
  if (!isValidSlug(id)) throw new ConfigEditError(`id must match ${SLUG_PATTERN_TEXT}`);
  const directory = resolve(paths[level].directory, KIND_DIRECTORY[kind]);
  const yaml = join(directory, `${id}.yaml`);
  const yml = join(directory, `${id}.yml`);
  const file = !existsSync(yaml) && existsSync(yml) ? yml : yaml;
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
    if (sameValue(current[key], next)) continue;
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
  workflow?: string;
  step?: string;
  split?: boolean;
  /** `delivery.resolver` or `delivery.message_specialist`. */
  field?: string;
}

/** Everything in a merged `{ swarm }` tree that names the specialist. */
export function specialistReferences(tree: unknown, slug: string): EntryReference[] {
  const swarm = isMapping(tree) && isMapping(tree.swarm) ? tree.swarm : {};
  const references: EntryReference[] = [];
  const workflows = isMapping(swarm.workflows) ? swarm.workflows : {};
  for (const [id, workflow] of Object.entries(workflows)) {
    if (!isMapping(workflow)) continue;
    if (isMapping(workflow.split) && workflow.split.specialist === slug) {
      references.push({ workflow: id, split: true });
    }
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    for (const [index, step] of steps.entries()) {
      if (isMapping(step) && step.specialist === slug) {
        references.push({
          workflow: id,
          step: typeof step.id === 'string' ? step.id : String(index),
        });
      }
    }
  }
  const delivery = isMapping(swarm.delivery) ? swarm.delivery : {};
  for (const field of ['resolver', 'message_specialist']) {
    if (delivery[field] === slug) references.push({ field: `delivery.${field}` });
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

function readText(file: string): string | undefined {
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

function stemOf(path: string): string {
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
  const list =
    text === null ? others : [...others, { path: file, value: parseYaml(text, file), text }];
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
  return assembleLevel({ specialists: [], workflows: [], problems: [] });
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
 * Checks an edit without writing: the revision, then the whole configuration with the file
 * replaced in memory. Only errors the current configuration does not have reject the edit.
 */
export function planEdit(paths: ConfigPaths, edit: EditRequest): EditPlan {
  const level = edit.level ?? 'project';
  const file = entryFile(paths, edit.kind, edit.id, level);
  const current = readText(file);
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
  if (edit.value === null && edit.kind === 'specialist') {
    const inGlobal = sourcesOf(draft.files.global, 'specialist').some(
      (source) => stemOf(source.path) === edit.id,
    );
    const inProject = sourcesOf(draft.files.project, 'specialist').some(
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
      add(specialistReferences(globalTree, edit.id));
      if (!inProject) add(specialistReferences(mergeConfigs(globalTree, projectTree), edit.id));
    } else if (!inGlobal) {
      add(specialistReferences(mergeConfigs(globalTree, projectTree), edit.id));
    }
    if (references.length > 0) return { ok: false, reason: 'invalid', errors: [], references };
  }
  const known = new Set(draft.before.errors.map(key));
  const added = draft.after.errors.filter((error) => !known.has(key(error)));
  if (added.length > 0) return { ok: false, reason: 'invalid', errors: added };
  return { ok: true, file, text: draft.text, revision: revisionOf(draft.text ?? undefined) };
}

/** Fields of settings.yaml the editor may write; the list grows deliberately. */
export const SETTABLE_SETTINGS = ['delivery.auto'] as const;
export type SettingPath = (typeof SETTABLE_SETTINGS)[number];

export interface SettingRequest {
  path: string;
  /** New value; null removes the field. */
  value: boolean | null;
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
export function editSetting(text: string | undefined, path: string, value: boolean | null): string {
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

/** Checks a write of one setting without writing: the revision, then the whole configuration. */
export function planSetting(paths: ConfigPaths, request: SettingRequest): EditPlan {
  const level = request.level ?? 'global';
  if (!(SETTABLE_SETTINGS as readonly string[]).includes(request.path)) {
    throw new ConfigEditError(
      `\`${request.path}\` cannot be written; allowed: ${SETTABLE_SETTINGS.join(', ')}`,
    );
  }
  const file = settingsFile(paths, level);
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
  let text: string;
  try {
    text = editSetting(current, request.path, request.value);
  } catch (error) {
    if (!(error instanceof ConfigEditError)) throw error;
    return {
      ok: false,
      reason: 'invalid',
      errors: [{ file, path: `swarm.${request.path}`, message: error.message }],
    };
  }
  const files = readLevels(paths);
  const before = resolution(assembleLevel(files.global), assembleLevel(files.project));
  const settings: ConfigSource = { path: file, value: parseYaml(text, file), text };
  const drafted = { ...files, [level]: { ...files[level], settings } };
  const after = resolution(assembleLevel(drafted.global), assembleLevel(drafted.project));
  const known = new Set(before.errors.map(key));
  const added = after.errors.filter((error) => !known.has(key(error)));
  if (added.length > 0) return { ok: false, reason: 'invalid', errors: added };
  return { ok: true, file, text, revision: revisionOf(text) };
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

/** A workflow in the editor: where it lives and what its files say. */
export interface EditorWorkflow {
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
  workflows: EditorWorkflow[];
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
    ['workspace.base', config.workspace.base],
    ['workspace.include', config.workspace.include],
    ['naming.enabled', config.naming.enabled],
    ['naming.runtime', config.naming.runtime],
    ['naming.model', config.naming.model],
  ];
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
    };
  });
  const globalWorkflows = byStem(files.global.workflows);
  const projectWorkflows = byStem(files.project.workflows);
  const workflows = [...new Set([...globalWorkflows.keys(), ...projectWorkflows.keys()])]
    .sort()
    .map((id): EditorWorkflow => {
      const inProject = projectWorkflows.get(id);
      const inGlobal = globalWorkflows.get(id);
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
  const settings = settingsOf(configOrDefaults(config)).map(([path, value]) => ({
    path,
    value,
    file: origins.get(`swarm.${path}`) ?? null,
  }));
  const settingsView = (level: WriteLevel): SettingsFileView => ({
    file: settingsFile(paths, level),
    revision: revisionOf(files[level].settings?.text),
  });
  return {
    directories: { global: paths.global.directory, project: paths.project.directory },
    settingsFiles: { global: settingsView('global'), project: settingsView('project') },
    specialists,
    workflows,
    settings,
    errors,
  };
}
