import { repositoryRoot } from '../../../platform/git/index.ts';
import type { ReposPublishPort } from '../ports/index.ts';
import type { KnownRepositories } from '../repositories/index.ts';
import type { KnownRepository } from '../types/index.ts';

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

  /** Reads the registry from the database; called once at the start. */
  load(): void {
    for (const entry of this.dependencies.known.repositories()) {
      this.registry.set(entry.path, entry);
    }
  }

  /** The root of the repository that holds `path`; a new root joins the registry. */
  async rootOf(path: string): Promise<string> {
    const root = await repositoryRoot(path);
    this.remember(root);
    return root;
  }

  /** Adds a repository root to the registry when it is not there yet. */
  remember(root: string): void {
    if (this.registry.has(root)) return;
    const addedAt = this.dependencies.now();
    this.dependencies.known.addRepository(root, addedAt);
    this.registry.set(root, { path: root, addedAt });
    this.dependencies.publish.repositoriesChanged();
  }

  has(root: string): boolean {
    return this.registry.has(root);
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

  /** Removes a root from the registry and tells the clients. */
  forget(root: string): void {
    this.dependencies.known.removeRepository(root);
    this.registry.delete(root);
    this.dependencies.publish.repositoriesChanged();
  }
}
