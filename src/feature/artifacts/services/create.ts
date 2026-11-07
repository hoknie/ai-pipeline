import { join } from 'node:path';

import type { Database } from '../../../platform/sqlite/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import type { ArtifactsPublishPort } from '../ports/index.ts';
import { ArtifactRepository, FileArtifactStorage } from '../repositories/index.ts';

import { ArtifactService } from './artifacts.ts';

export interface ArtifactsServices {
  artifacts: ArtifactService;
}

export function createArtifactsServices(dependencies: {
  database: Database;
  /** The state directory: artifacts are kept in its `artifacts` folder. */
  stateDirectory: string;
  runs: RunsServices;
  now: () => number;
  publish: ArtifactsPublishPort;
}): ArtifactsServices {
  const { database, stateDirectory, ...rest } = dependencies;
  return {
    artifacts: new ArtifactService({
      ...rest,
      artifacts: new ArtifactRepository(database),
      storages: [new FileArtifactStorage(join(stateDirectory, 'artifacts'))],
    }),
  };
}
