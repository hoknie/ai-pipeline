import { rejected } from '../../../../platform/errors/index.ts';
import { AUDIT_SYSTEM, AUDIT_DEFAULT_LIMIT } from '../../../../feature/audit/types/index.ts';
import { DAY, parseTtl } from '../../../../feature/identity/types/index.ts';
import type { AuditEventView } from '../../contract/index.ts';
import { serverSettings } from '../identity/index.ts';
import type { HandlerTable } from '../types.ts';

/** How far back the journal is read when `since` is absent. */
const DEFAULT_SINCE_DAYS = 7;

/** The reading of the journal: only for administrators (the guard), only in server mode. */
export const auditHandlers: Pick<HandlerTable, 'audit_list'> = {
  audit_list: async (params, context) => {
    if (!serverSettings(context).enabled) {
      throw rejected('server mode is off: set server.enabled in the shared settings.yaml');
    }
    const { audit, identity, registry, now } = context.services;
    const span = params.since === undefined ? DEFAULT_SINCE_DAYS * DAY : parseTtl(params.since);
    if (span === null) throw rejected('since must be <n>m, <n>h or <n>d');
    let subject: string | undefined;
    if (params.user !== undefined) {
      if (params.user === AUDIT_SYSTEM) subject = AUDIT_SYSTEM;
      else {
        const user = identity.users.byEmail(params.user);
        if (!user) throw rejected(`unknown user ${params.user}`);
        subject = user.id;
      }
    }
    let repository: string | undefined;
    if (params.repository !== undefined) {
      try {
        repository = registry.pathOf(params.repository);
      } catch {
        throw rejected(`unknown project ${params.repository}`);
      }
    }
    const events = audit.list({
      subject,
      repository,
      action: params.action,
      since: now() - span,
      limit: params.limit ?? AUDIT_DEFAULT_LIMIT,
    });
    const known = new Map<string, AuditEventView['user']>();
    const userOf = (id: string): AuditEventView['user'] => {
      if (id === AUDIT_SYSTEM) return null;
      if (!known.has(id)) {
        const user = identity.users.byId(id);
        known.set(id, user ? { id: user.id, email: user.email, name: user.name } : null);
      }
      return known.get(id) ?? null;
    };
    return { events: events.map((event) => ({ ...event, user: userOf(event.subject) })) };
  },
};
