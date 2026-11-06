import type { ConfigPaths } from './discover.ts';
import { revisionOf, pipelineReferences, stemOf, type EntryReference } from './edit.ts';
import { assembleLevel, readLevel, type Level } from './load.ts';
import { isMapping, mergeConfigs } from './merge.ts';
import { tagsOf } from './tag-names.ts';

/** A repository of the registry that needs a shared pipeline, and why. */
export interface SharedPipelineProject {
  repository: string;
  references: EntryReference[];
}

/** One shared pipeline file with the places that need it. */
export interface SharedPipelineUsage {
  id: string;
  name: string | null;
  /** Shared tags of the file. */
  tags: string[];
  /** Path of the shared file. */
  file: string;
  /** Revision of the file; null when the file could not be read. */
  revision: string | null;
  /** Why the file cannot be read; there are no references then. */
  error?: string;
  /** References from the shared level (shared pipelines that delegate through `split.pipeline`). */
  global: EntryReference[];
  /** Repositories where the shared pipeline is used, in the order of `projects` of the call. */
  projects: SharedPipelineProject[];
}

export interface SharedPipelinesUsage {
  /** Directory with the shared pipeline files. */
  directory: string;
  pipelines: SharedPipelineUsage[];
}

function projectHas(level: Level, id: string): boolean {
  const pipelines = isMapping(level.tree) && isMapping(level.tree.swarm) ? level.tree.swarm : {};
  const map = isMapping(pipelines.pipelines) ? pipelines.pipelines : {};
  return Object.hasOwn(map, id);
}

/**
 * The shared pipelines in id order with the repositories that use them. A shared pipeline is
 * used by a repository without a project file of that id when its merged configuration refers to it.
 * Works on files that read as YAML, so a configuration that fails validation still gives references.
 */
export function sharedPipelineUsage(
  global: ConfigPaths,
  projects: readonly { repository: string; paths: ConfigPaths }[],
  only?: string,
): SharedPipelinesUsage {
  const files = readLevel(global.global, { tolerant: true });
  const globalLevel = assembleLevel(files);
  const levels = projects.map((project) => ({
    repository: project.repository,
    level: assembleLevel(readLevel(project.paths.project, { tolerant: true })),
  }));
  const entries = new Map<string, SharedPipelineUsage>();
  const directory = `${global.global.directory}/pipelines`;
  for (const source of files.pipelines) {
    const id = stemOf(source.path);
    const raw = isMapping(source.value) ? source.value : {};
    entries.set(id, {
      id,
      name: typeof raw.name === 'string' ? raw.name : null,
      tags: tagsOf(raw),
      file: source.path,
      revision: revisionOf(source.text),
      global: [],
      projects: [],
    });
  }
  const marker = 'swarm.pipelines.';
  for (const problem of files.problems) {
    if (!problem.path.startsWith(marker)) continue;
    const id = problem.path.slice(marker.length);
    entries.set(id, {
      id,
      name: null,
      tags: [],
      file: problem.file ?? `${directory}/${id}.yaml`,
      revision: null,
      error: problem.message,
      global: [],
      projects: [],
    });
  }
  const result: SharedPipelineUsage[] = [];
  for (const entry of [...entries.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (only !== undefined && entry.id !== only) continue;
    if (entry.error === undefined) {
      entry.global = pipelineReferences(globalLevel.tree, entry.id);
      for (const { repository, level } of levels) {
        if (projectHas(level, entry.id)) continue;
        const references = pipelineReferences(mergeConfigs(globalLevel.tree, level.tree), entry.id);
        if (references.length > 0) entry.projects.push({ repository, references });
      }
    }
    result.push(entry);
  }
  return { directory, pipelines: result };
}
