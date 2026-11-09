import { isAbsolute, resolve } from 'node:path';

import { rejected } from '../../../platform/errors/index.ts';
import { repositoryRoot } from '../../../platform/git/index.ts';
import { expandHome } from '../../../platform/paths/index.ts';
import type { ReposPublishPort } from '../ports/index.ts';
import type { KnownRepositories } from '../repositories/index.ts';
import {
  type KnownRepository,
  directoryName,
  freeSlug,
  isProjectSlug,
  slugOf,
} from '../types/index.ts';

export interface RegistryDependencies {
  known: KnownRepositories;
  now: () => number;
  publish: ReposPublishPort;
}

/** The registry of the user's repositories, kept in memory and in the database. */
export class RegistryService {
  private readonly dependencies: RegistryDependencies;
  private readonly registry = new Map<string, KnownRepository>();

  constructor(dependencies: RegistryDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads the registry from the database and gives a slug to every project without one. */
  load(): void {
    const entries = this.dependencies.known.repositories();
    for (const entry of entries) this.registry.set(entry.path, entry);
    const unnamed = entries
      .filter((entry) => entry.slug === null)
      .sort((left, right) => left.addedAt - right.addedAt);
    for (const entry of unnamed) {
      entry.slug = freeSlugFor(this.registry, entry.path);
      this.dependencies.known.updateRepository(entry);
    }
  }

  /**
   * The root of the repository a reference names: a slug of the registry, or a path whose root
   * joins the registry when it is new. A slug never adds anything.
   */
  async rootOf(reference: string): Promise<string> {
    if (!isAbsolute(reference) && isProjectSlug(reference))
      return bySlug(this.registry, reference).path;
    const path = expandHome(reference);
    // A project of the registry answers without git: its directory may be gone or moved.
    if (this.registry.has(path)) return path;
    const root = await repositoryRoot(path);
    this.remember(root);
    return root;
  }

  /** The root of a project of the registry, by path or slug; an unknown one is refused. */
  async resolve(reference: string): Promise<string> {
    if (!isAbsolute(reference) && isProjectSlug(reference))
      return bySlug(this.registry, reference).path;
    const path = expandHome(reference);
    if (this.registry.has(path)) return path;
    let root: string;
    try {
      root = await repositoryRoot(path);
    } catch {
      root = resolve(path);
    }
    if (!this.registry.has(root)) throw rejected(`unknown repository ${root}`);
    return root;
  }

  /** Adds a repository root to the registry when it is not there yet. */
  remember(root: string, attributes: Partial<KnownRepository> = {}): void {
    if (this.registry.has(root)) return;
    const entry: KnownRepository = {
      path: root,
      addedAt: this.dependencies.now(),
      name: attributes.name ?? null,
      slug: attributes.slug ?? freeSlugFor(this.registry, root),
      enabled: true,
      color: attributes.color ?? null,
    };
    this.dependencies.known.addRepository(root, entry.addedAt, entry);
    this.registry.set(root, entry);
    this.dependencies.publish.repositoriesChanged();
  }

  /** The path of a slug of the registry; any other reference is returned as it is. */
  pathOf(reference: string): string {
    if (isAbsolute(reference) || !isProjectSlug(reference)) return reference;
    return bySlug(this.registry, reference).path;
  }

  has(root: string): boolean {
    return this.registry.has(root);
  }

  /** The project of a root; undefined when it is not in the registry. */
  entry(root: string): KnownRepository | undefined {
    return this.registry.get(root);
  }

  /** Writes the changed attributes of a project and tells the clients. */
  save(project: KnownRepository): void {
    this.dependencies.known.updateRepository(project);
    this.registry.set(project.path, { ...project });
    this.dependencies.publish.repositoriesChanged();
  }

  /** Refuses new work in a disabled project. */
  requireEnabled(root: string): void {
    const entry = this.registry.get(root);
    if (entry !== undefined && !entry.enabled) {
      throw rejected(`project \`${entry.slug ?? directoryName(root)}\` is disabled`);
    }
  }

  /** The entries in the order they were added. */
  entries(): KnownRepository[] {
    return [...this.registry.values()];
  }

  /** The roots sorted by path, as the list of repositories shows them. */
  paths(): string[] {
    return [...this.registry.keys()].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
  }

  /** Removes a root from the registry and tells the clients; `to` moves it to another root instead. */
  forget(root: string, to?: string): void {
    const entry = this.registry.get(root);
    if (to !== undefined && entry !== undefined) {
      this.dependencies.known.moveRepository(root, to);
      this.registry.delete(root);
      this.registry.set(to, { ...entry, path: to });
    } else {
      this.dependencies.known.removeRepository(root);
      this.registry.delete(root);
    }
    this.dependencies.publish.repositoriesChanged();
  }
}

function bySlug(registry: Map<string, KnownRepository>, slug: string): KnownRepository {
  for (const entry of registry.values()) if (entry.slug === slug) return entry;
  throw rejected(`unknown project \`${slug}\``);
}

/** The slug a new root gets: from its directory name, with a suffix when it is taken. */
function freeSlugFor(registry: Map<string, KnownRepository>, root: string): string {
  const taken = new Set<string>();
  for (const entry of registry.values()) if (entry.slug !== null) taken.add(entry.slug);
  return freeSlug(slugOf(directoryName(root)), taken);
}
