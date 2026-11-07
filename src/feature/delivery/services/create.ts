import { join } from 'node:path';

import type { Database } from '../../../platform/sqlite/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import type { DeliveryPublishPort } from '../ports/index.ts';
import { FilePatchStorage, PatchRepository } from '../repositories/index.ts';

import { DeliverService } from './deliver.ts';
import { DiffService } from './diffs.ts';
import { PatchService } from './patches.ts';

export interface DeliveryServices {
  diffs: DiffService;
  patches: PatchService;
  deliver: DeliverService;
}

export function createDeliveryServices(dependencies: {
  database: Database;
  /** The state directory: patches are kept in its `patches` folder. */
  stateDirectory: string;
  runs: RunsServices;
  now: () => number;
  publish: DeliveryPublishPort;
}): DeliveryServices {
  const { database, runs, now, publish } = dependencies;
  const storages = [new FilePatchStorage(join(dependencies.stateDirectory, 'patches'))];
  return {
    diffs: new DiffService({ runs, publish }),
    patches: new PatchService({
      patches: new PatchRepository(database),
      storages,
      states: runs.states,
      now,
      stopping: () => runs.engine.stopping,
    }),
    deliver: new DeliverService({ states: runs.states, engine: runs.engine }),
  };
}
