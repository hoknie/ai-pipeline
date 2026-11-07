import { assembleLevel, readLevel } from '../../swarm-config/services/index.ts';
import {
  type ConfigPaths,
  isMapping,
  type Level,
  mergeConfigs,
} from '../../swarm-config/types/index.ts';
import { revisionOf } from '../repositories/documents.ts';
import { specialistReferences, stemOf } from './references.ts';
import { type SharedSpecialistsUsage, type SharedSpecialistUsage } from '../types/shared.ts';

function projectHas(level: Level, slug: string): boolean {
  const specialists = isMapping(level.tree) && isMapping(level.tree.swarm) ? level.tree.swarm : {};
  const map = isMapping(specialists.specialists) ? specialists.specialists : {};
  return Object.hasOwn(map, slug);
}

/**
 * The shared specialists in slug order with the repositories that use them. A shared specialist is
 * used by a repository without a project file of that slug when its merged configuration refers to it.
 * Works on files that read as YAML, so a configuration that fails validation still gives references.
 */
export function sharedSpecialistUsage(
  global: ConfigPaths,
  projects: readonly { repository: string; paths: ConfigPaths }[],
  only?: string,
): SharedSpecialistsUsage {
  const files = readLevel(global.global, { tolerant: true });
  const globalLevel = assembleLevel(files);
  const levels = projects.map((project) => ({
    repository: project.repository,
    level: assembleLevel(readLevel(project.paths.project, { tolerant: true })),
  }));
  const entries = new Map<string, SharedSpecialistUsage>();
  const directory = `${global.global.directory}/specialists`;
  for (const source of files.specialists) {
    const slug = stemOf(source.path);
    const raw = isMapping(source.value) ? source.value : {};
    entries.set(slug, {
      slug,
      name: typeof raw.name === 'string' ? raw.name : null,
      file: source.path,
      revision: revisionOf(source.text),
      global: [],
      projects: [],
    });
  }
  const marker = 'swarm.specialists.';
  for (const problem of files.problems) {
    if (!problem.path.startsWith(marker)) continue;
    const slug = problem.path.slice(marker.length);
    entries.set(slug, {
      slug,
      name: null,
      file: problem.file ?? `${directory}/${slug}.yaml`,
      revision: null,
      error: problem.message,
      global: [],
      projects: [],
    });
  }
  const result: SharedSpecialistUsage[] = [];
  for (const entry of [...entries.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    if (only !== undefined && entry.slug !== only) continue;
    if (entry.error === undefined) {
      entry.global = specialistReferences(globalLevel.tree, entry.slug);
      for (const { repository, level } of levels) {
        if (projectHas(level, entry.slug)) continue;
        const references = specialistReferences(
          mergeConfigs(globalLevel.tree, level.tree),
          entry.slug,
        );
        if (references.length > 0) entry.projects.push({ repository, references });
      }
    }
    result.push(entry);
  }
  return { directory, specialists: result };
}
