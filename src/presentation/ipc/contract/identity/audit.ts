import { AUDIT_MAX_LIMIT, type AuditOutcome } from '../../../../feature/audit/types/index.ts';
import { z } from 'zod';

export const auditRequests = [
  z.object({
    method: z.literal('audit_list'),
    params: z
      .object({
        /** The email of a user, or `system`. */
        user: z.string().trim().min(1).max(320).optional(),
        /** A project: a path or a slug. */
        repository: z.string().min(1).max(4096).optional(),
        /** The entries whose action starts with this text. */
        action: z.string().min(1).max(128).optional(),
        /** How far back to look: `<n>m`, `<n>h` or `<n>d`; absent: 7 days. */
        since: z.string().min(2).max(16).optional(),
        limit: z.number().int().min(1).max(AUDIT_MAX_LIMIT).optional(),
      })
      .default({}),
  }),
] as const;

/** One entry of the journal as clients see it. */
export interface AuditEventView {
  id: number;
  at: number;
  /** The id of the user, or `system`. */
  subject: string;
  /** The user of the entry; `null` for `system` and for a user that is gone. */
  user: { id: string; email: string; name: string } | null;
  action: string;
  /** The path of the project; `null`: none. */
  repository: string | null;
  resourceKind: string | null;
  resourceId: string | null;
  outcome: AuditOutcome;
  details: Record<string, unknown>;
  error: string | null;
}

export interface AuditView {
  events: AuditEventView[];
}
