import type { Database } from '../../../platform/sqlite/index.ts';
import { ObserverRepository } from '../repositories/index.ts';

import { ObserverService, type ObserverDependencies } from './observers.ts';
import { ObserverHistoryService } from './history.ts';

export interface ObserversServices {
  observers: ObserverService;
  history: ObserverHistoryService;
}

export function createObserversServices(
  dependencies: Omit<ObserverDependencies, 'observers' | 'runs'> & {
    database: Database;
    runs: import('../../runs/services/index.ts').RunsServices;
  },
): ObserversServices {
  const { database, ...rest } = dependencies;
  return {
    observers: new ObserverService({ ...rest, observers: new ObserverRepository(database) }),
    history: new ObserverHistoryService(dependencies.runs, dependencies.now),
  };
}
