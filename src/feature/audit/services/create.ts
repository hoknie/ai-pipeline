import type { Database } from '../../../platform/sqlite/index.ts';
import { AuditEventsRepository } from '../repositories/index.ts';

import { AuditLog } from './audit-log.ts';

export interface AuditServices {
  log: AuditLog;
}

export function createAuditServices(dependencies: { database: Database }): AuditServices {
  return { log: new AuditLog({ events: new AuditEventsRepository(dependencies.database) }) };
}
