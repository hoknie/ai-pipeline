import type { Database } from '../../../platform/sqlite/index.ts';
import { ObserverRepository } from '../repositories/index.ts';

import { ObserverService, type ObserverDependencies } from './observers.ts';

export interface ObserversServices {
  observers: ObserverService;
}

export function createObserversServices(
  dependencies: Omit<ObserverDependencies, 'observers'> & { database: Database },
): ObserversServices {
  const { database, ...rest } = dependencies;
  return {
    observers: new ObserverService({ ...rest, observers: new ObserverRepository(database) }),
  };
}
