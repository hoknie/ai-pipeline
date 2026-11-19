import type { Method } from '../../contract/index.ts';
import { accountActions } from './audit-account-actions.ts';
import { runActions } from './audit-actions.ts';
import type { AuditRow } from './audit-helpers.ts';
import { settingsActions } from './audit-settings-actions.ts';

/** Every method of the daemon that changes something, and how the journal writes it. */
export const auditActions: Partial<Record<Method, AuditRow>> = {
  ...runActions,
  ...settingsActions,
  ...accountActions,
};
