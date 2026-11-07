import { RepositoryRemoval, type RepositoryRemovalDependencies } from './repository-removal.ts';

export interface ComposeServices {
  repositoryRemoval: RepositoryRemoval;
}

export function createComposeServices(
  dependencies: RepositoryRemovalDependencies,
): ComposeServices {
  return { repositoryRemoval: new RepositoryRemoval(dependencies) };
}
