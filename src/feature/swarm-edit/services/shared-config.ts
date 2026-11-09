import { rejected } from '../../../platform/errors/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { ConfigPaths } from '../../swarm-config/types/index.ts';
import type { ConfigChangedPort } from '../ports/index.ts';
import {
  ConfigEditError,
  type EntryReference,
  type PipelinesImportResult,
  type SharedPipelinesUsage,
  type SharedSpecialistsUsage,
  type SpecialistTagFolderView,
  type SpecialistTagsResult,
  type SpecialistTagsView,
  type SpecialistsImportResult,
  type TagPlan,
} from '../types/index.ts';

import { sharedPipelineUsage } from './shared-pipelines.ts';
import { sharedSpecialistUsage } from './shared-specialists.ts';
import {
  commitEdits,
  planImport,
  planTagRemove,
  planTagRename,
  planTagsSet,
  tagFolder,
} from './specialist-tags.ts';

export interface SharedConfigDependencies {
  config: ConfigService;
  registry: RegistryService;
  changed: ConfigChangedPort;
}

/** A plan of the editor; its own errors become a refusal of the request. */
function planned<T>(plan: () => T): T {
  try {
    return plan();
  } catch (error) {
    if (error instanceof ConfigEditError) throw rejected(error.message);
    throw error;
  }
}

/** The shared specialists and pipelines, their tags and their import between repositories. */
export class SharedConfigService {
  private readonly dependencies: SharedConfigDependencies;

  constructor(dependencies: SharedConfigDependencies) {
    this.dependencies = dependencies;
  }

  /** The shared specialists with the repositories of the registry that need them. */
  specialists(): SharedSpecialistsUsage {
    return sharedSpecialistUsage(this.shared(), this.projects(this.dependencies.registry.paths()));
  }

  /** The shared pipelines with the repositories of the registry that need them. */
  pipelines(): SharedPipelinesUsage {
    return sharedPipelineUsage(this.shared(), this.projects(this.dependencies.registry.paths()));
  }

  /** References to a shared specialist from the registry and the requesting repository. */
  specialistUsageOf(repository: string, slug: string): EntryReference[] {
    const usage = sharedSpecialistUsage(this.shared(), this.projects(this.with(repository)), slug);
    return (usage.specialists[0]?.projects ?? []).flatMap((project) =>
      project.references.map((reference) => ({ ...reference, repository: project.repository })),
    );
  }

  /** References to a shared pipeline from the registry and the requesting repository. */
  pipelineUsageOf(repository: string, id: string): EntryReference[] {
    const usage = sharedPipelineUsage(this.shared(), this.projects(this.with(repository)), id);
    return (usage.pipelines[0]?.projects ?? []).flatMap((project) =>
      project.references.map((reference) => ({ ...reference, repository: project.repository })),
    );
  }

  /** The shared level, then one folder per repository of the registry. */
  specialistTags(): SpecialistTagsView {
    const repositories = [null, ...this.dependencies.registry.paths()];
    return { folders: repositories.map((repository) => this.tagFolder(repository)) };
  }

  setTags(repository: string | null, slug: string, tags: string[], revision: string | null) {
    return this.tagEdit(repository, (paths, level) =>
      planTagsSet(paths, level, slug, tags, revision),
    );
  }

  renameTag(repository: string | null, from: string, to: string) {
    return this.tagEdit(repository, (paths, level) => planTagRename(paths, level, from, to));
  }

  removeTag(repository: string | null, tag: string) {
    return this.tagEdit(repository, (paths, level) => planTagRemove(paths, level, tag));
  }

  importSpecialists(params: {
    repository: string;
    source: string;
    slugs: string[];
  }): SpecialistsImportResult {
    const plan = this.importPlan(params.repository, params.source, params.slugs, 'specialist');
    if (!plan.ok) return plan;
    commitEdits(plan.edits);
    this.dependencies.changed.configChanged(this.dependencies.registry.pathOf(params.repository));
    return { ok: true, imported: [...new Set(params.slugs)] };
  }

  importPipelines(params: {
    repository: string;
    source: string;
    ids: string[];
  }): PipelinesImportResult {
    const plan = this.importPlan(params.repository, params.source, params.ids, 'pipeline');
    if (!plan.ok) {
      return plan.reason === 'conflict'
        ? {
            ok: false,
            reason: 'conflict',
            message: plan.message,
            ...(plan.slugs ? { ids: plan.slugs } : {}),
          }
        : plan;
    }
    commitEdits(plan.edits);
    this.dependencies.changed.configChanged(this.dependencies.registry.pathOf(params.repository));
    return { ok: true, imported: [...new Set(params.ids)] };
  }

  private shared(): ConfigPaths {
    return this.dependencies.config.pathsOf('/');
  }

  private projects(roots: readonly string[]) {
    return roots.map((root) => ({
      repository: root,
      paths: this.dependencies.config.pathsOf(root),
    }));
  }

  /** The registry with the requesting repository, which may not be in it yet. */
  private with(repository: string): string[] {
    const roots = new Set(this.dependencies.registry.paths());
    roots.add(repository);
    return [...roots];
  }

  private tagFolder(repository: string | null): SpecialistTagFolderView {
    const paths = this.dependencies.config.pathsOf(repository ?? '/');
    return { repository, ...tagFolder(paths, repository === null ? 'global' : 'project') };
  }

  /** Plans and writes without an await between them, so two edits never interleave. */
  private tagEdit(
    reference: string | null,
    plan: (paths: ConfigPaths, level: 'global' | 'project') => TagPlan,
  ): SpecialistTagsResult {
    const repository = reference === null ? null : this.dependencies.registry.pathOf(reference);
    if (repository !== null && !this.dependencies.registry.has(repository)) {
      throw rejected(`unknown repository ${repository}`);
    }
    const level = repository === null ? 'global' : 'project';
    const result = planned(() => plan(this.dependencies.config.pathsOf(repository ?? '/'), level));
    if (!result.ok) return result;
    commitEdits(result.edits);
    if (repository !== null) this.dependencies.changed.configChanged(repository);
    return { ok: true, folder: this.tagFolder(repository) };
  }

  private importPlan(
    target: string,
    from: string,
    ids: string[],
    kind: 'specialist' | 'pipeline',
  ): TagPlan {
    const repository = this.dependencies.registry.pathOf(target);
    const source = this.dependencies.registry.pathOf(from);
    for (const path of [repository, source]) {
      if (!this.dependencies.registry.has(path)) throw rejected(`unknown repository ${path}`);
    }
    if (repository === source) throw rejected('the source must be another repository');
    const { config } = this.dependencies;
    return planned(() =>
      kind === 'specialist'
        ? planImport(config.pathsOf(repository), config.pathsOf(source), ids)
        : planImport(config.pathsOf(repository), config.pathsOf(source), ids, 'pipeline'),
    );
  }
}
