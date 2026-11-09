import { rejected } from '../../../platform/errors/index.ts';
import { repositoryRoot } from '../../../platform/git/index.ts';
import { expandHome } from '../../../platform/paths/index.ts';
import {
  type KnownRepository,
  type ProjectChanges,
  checkColor,
  checkName,
  checkSlug,
} from '../types/index.ts';

import type { RegistryService } from './registry.ts';

/** The attributes `repository_add` may give a new project. */
export type NewProject = Pick<ProjectChanges, 'name' | 'slug' | 'color'>;

/** Adding a project with its attributes and changing the attributes of a known one. */
export class ProjectService {
  private readonly registry: RegistryService;

  constructor(registry: RegistryService) {
    this.registry = registry;
  }

  /** Adds the root of `path` (`~` is the home directory); known roots stay as they are unless attributes come with them. */
  async add(path: string, attributes: NewProject = {}): Promise<string> {
    const root = await repositoryRoot(expandHome(path));
    const given = Object.values(attributes).some((value) => value !== undefined);
    if (this.registry.has(root)) {
      if (given) throw rejected('repository is already registered');
      return root;
    }
    const name = attributes.name === undefined ? null : checkName(attributes.name);
    const color = attributes.color === undefined ? null : checkColor(attributes.color);
    const slug = attributes.slug === undefined ? undefined : this.freeOf(attributes.slug, root);
    this.registry.remember(root, { name, color, ...(slug === undefined ? {} : { slug }) });
    return root;
  }

  /** Changes the given attributes of a project, by path or slug; returns the project after. */
  async update(reference: string, changes: ProjectChanges): Promise<KnownRepository> {
    const root = await this.registry.resolve(reference);
    const current = this.registry.entry(root)!;
    const next: KnownRepository = {
      ...current,
      ...(changes.name === undefined ? {} : { name: checkName(changes.name) }),
      ...(changes.slug === undefined ? {} : { slug: this.freeOf(changes.slug, root) }),
      ...(changes.enabled === undefined ? {} : { enabled: changes.enabled }),
      ...(changes.color === undefined ? {} : { color: checkColor(changes.color) }),
    };
    this.registry.save(next);
    return next;
  }

  /** A slug the user chose: it fits the pattern and no other project has it. */
  private freeOf(slug: string, root: string): string {
    checkSlug(slug);
    const owner = this.registry.entries().find((entry) => entry.slug === slug);
    if (owner !== undefined && owner.path !== root) {
      throw rejected(`project slug \`${slug}\` is taken`);
    }
    return slug;
  }
}
