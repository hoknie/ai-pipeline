import { join } from 'node:path';

import type { Database } from '../../../platform/sqlite/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { DeliveryAuthorsPort, DeliveryPublishPort } from '../ports/index.ts';
import { FilePatchStorage, PatchRepository } from '../repositories/index.ts';

import { CommitStamper } from './commit-stamp.ts';
import { DeliverService } from './deliver.ts';
import { DiffService } from './diffs.ts';
import { PatchService } from './patches.ts';
import { PushService } from './push.ts';

export interface DeliveryServices {
  diffs: DiffService;
  patches: PatchService;
  deliver: DeliverService;
  /** Stamps the commits of the deliveries of the runs; set on the runs as their port. */
  commits: CommitStamper;
  /** Sends the branch of a delivery to the remote repository; set on the runs as their port. */
  push: PushService;
}

export function createDeliveryServices(dependencies: {
  database: Database;
  /** The state directory: patches are kept in its `patches` folder. */
  stateDirectory: string;
  runs: RunsServices;
  now: () => number;
  publish: DeliveryPublishPort;
  config: ConfigService;
  authors: DeliveryAuthorsPort;
}): DeliveryServices {
  const { database, runs, now, publish, config, authors } = dependencies;
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
    deliver: new DeliverService({ states: runs.states, engine: runs.engine, config }),
    commits: new CommitStamper({ config, authors }),
    push: new PushService(),
  };
}
