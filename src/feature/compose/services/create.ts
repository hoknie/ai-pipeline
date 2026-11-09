import { RepositoryEdit, type RepositoryEditDependencies } from './repository-edit.ts';
import { RepositoryMove, type RepositoryMoveDependencies } from './repository-move.ts';
import { RepositoryRemoval, type RepositoryRemovalDependencies } from './repository-removal.ts';

export interface ComposeServices {
  repositoryRemoval: RepositoryRemoval;
  repositoryEdit: RepositoryEdit;
  repositoryMove: RepositoryMove;
}

export function createComposeServices(
  dependencies: RepositoryRemovalDependencies &
    RepositoryEditDependencies &
    RepositoryMoveDependencies,
): ComposeServices {
  return {
    repositoryRemoval: new RepositoryRemoval(dependencies),
    repositoryEdit: new RepositoryEdit(dependencies),
    repositoryMove: new RepositoryMove(dependencies),
  };
}
