import { assembleLevel, validateConfig } from '../../swarm-config/services/index.ts';
import {
  type ConfigPaths,
  type ConfigSource,
  formatDuration,
  isMapping,
  type Level,
  mergeConfigs,
  type Specialist,
  tagsOf,
} from '../../swarm-config/types/index.ts';
import { revisionOf, settingsFile } from '../repositories/documents.ts';
import { readLevels, resolution } from './levels.ts';
import { stemOf } from './references.ts';
import {
  type ConfigEditorView,
  type EditorAction,
  type EditorPipeline,
  type EditorSpecialist,
  type EditorSpecialistValues,
  type EntryLevel,
  type EntrySource,
  type EntrySources,
  type SettingsFileView,
  type WriteLevel,
} from '../types/editor.ts';
import { editorSettings, type Files } from './editor-settings.ts';

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

function valuesOf(specialist: Specialist): EditorSpecialistValues {
  return {
    name: specialist.name,
    runtime: specialist.runtime,
    model: specialist.model,
    variant: specialist.variant ?? null,
    reasoning_effort: specialist.reasoningEffort ?? null,
    permissions: specialist.permissions,
    timeout: formatDuration(specialist.timeoutSeconds),
    allow_commands: specialist.allowCommands,
    tools: specialist.tools,
    skills: specialist.skills,
    prompt: specialist.prompt,
    max: specialist.max,
  };
}

function rawOf(source: ConfigSource | undefined): Record<string, unknown> {
  return isMapping(source?.value) ? source.value : {};
}

type Entries = Map<string, ConfigSource>;

const byStem = (sources: ConfigSource[]): Entries =>
  new Map(sources.map((source) => [stemOf(source.path), source]));

const levelOf = (inProject: unknown, inGlobal: unknown): EntryLevel =>
  inProject ? (inGlobal ? 'project_over_global' : 'project') : 'global';

/** The ids of a kind in both levels with the files that define each. */
function entriesOf(global: ConfigSource[], project: ConfigSource[]) {
  const inGlobal = byStem(global);
  const inProject = byStem(project);
  return [...new Set([...inGlobal.keys(), ...inProject.keys()])].sort().map((id) => {
    const own = inProject.get(id);
    const shared = inGlobal.get(id);
    return {
      id,
      level: levelOf(own, shared),
      source: (own ?? shared) as ConfigSource,
      own,
      shared,
    };
  });
}

function entryFields(entry: ReturnType<typeof entriesOf>[number]) {
  return {
    file: entry.source.path,
    revision: entry.own ? revisionOf(entry.own.text) : null,
    raw: rawOf(entry.source),
    sources: sourcesFor(entry.own, entry.shared),
  };
}

function editorSpecialists(files: Files, global: Level, project: Level): EditorSpecialist[] {
  const { config } = resolution(global, project);
  const merged = mergeConfigs(global.tree, project.tree);
  const swarm = isMapping(merged) && isMapping(merged.swarm) ? merged.swarm : {};
  const defaults = isMapping(swarm.defaults) ? swarm.defaults : {};
  return entriesOf(files.global.specialists, files.project.specialists).map((entry) => {
    const slug = entry.id;
    let effective: EditorSpecialistValues | null = null;
    const resolved = config?.specialists.find((candidate) => candidate.slug === slug);
    if (resolved) effective = valuesOf(resolved);
    else {
      const alone = validateConfig({
        swarm: { defaults, specialists: { [slug]: entry.source.value ?? null } },
      });
      const found = alone.ok ? alone.config.specialists[0] : undefined;
      if (found) effective = valuesOf(found);
    }
    return {
      slug,
      level: entry.level,
      ...entryFields(entry),
      effective,
      shared_tags: tagsOf(rawOf(entry.shared)),
      own_tags: tagsOf(rawOf(entry.own)),
    };
  });
}

function editorPipelines(files: Files): EditorPipeline[] {
  return entriesOf(files.global.pipelines, files.project.pipelines).map((entry) => ({
    id: entry.id,
    level: entry.level,
    ...entryFields(entry),
    shared_tags: tagsOf(rawOf(entry.shared)),
    own_tags: tagsOf(rawOf(entry.own)),
  }));
}

function editorActions(files: Files): EditorAction[] {
  return entriesOf(files.global.actions, files.project.actions).map((entry) => ({
    id: entry.id,
    level: entry.level,
    ...entryFields(entry),
  }));
}

/** Everything the specialists tab shows, also when the configuration does not pass validation. */
export function editorView(paths: ConfigPaths): ConfigEditorView {
  const files = readLevels(paths);
  const global = assembleLevel(files.global);
  const project = assembleLevel(files.project);
  const settingsView = (level: WriteLevel): SettingsFileView => ({
    file: settingsFile(paths, level),
    revision: revisionOf(files[level].settings?.text),
  });
  return {
    directories: { global: paths.global.directory, project: paths.project.directory },
    settingsFiles: { global: settingsView('global'), project: settingsView('project') },
    specialists: editorSpecialists(files, global, project),
    pipelines: editorPipelines(files),
    actions: editorActions(files),
    settings: editorSettings(paths, files, global, project),
    errors: resolution(global, project).errors,
  };
}
