/** The result of a call: it was done, the rights refused it, or it failed. */
export type AuditOutcome = 'ok' | 'denied' | 'failed';

export const AUDIT_OUTCOMES: readonly AuditOutcome[] = ['ok', 'denied', 'failed'];

/** The subject of a call of the system itself: the socket without a user. */
export const AUDIT_SYSTEM = 'system';

/** The longest text kept in the details of an entry (an answer to a question, an error). */
export const AUDIT_TEXT_LIMIT = 2000;

/** One entry of the journal: who did what, to what, and how it ended. */
export interface AuditEvent {
  id: number;
  /** When it happened (ms). */
  at: number;
  /** `system` or the id of a user. */
  subject: string;
  /** `run.cancel`, `config.write`, `auth.login`, … */
  action: string;
  /** The path of the project; `null` when the action has none. */
  repository: string | null;
  resourceKind: string | null;
  resourceId: string | null;
  outcome: AuditOutcome;
  /** The parameters of the action needed to understand it; never a secret. */
  details: Record<string, unknown>;
  /** The error text of a `failed` entry. */
  error: string | null;
}

export type NewAuditEvent = Omit<AuditEvent, 'id'>;

/** What the reader of the journal asks for. */
export interface AuditQuery {
  /** The id of a user, or `system`. */
  subject?: string | undefined;
  /** The path of a project. */
  repository?: string | undefined;
  /** The entries whose action starts with this text. */
  action?: string | undefined;
  /** Only the entries since this moment (ms). */
  since?: number | undefined;
  limit?: number | undefined;
}

export const AUDIT_DEFAULT_LIMIT = 200;
export const AUDIT_MAX_LIMIT = 1000;

/** `text` cut to `AUDIT_TEXT_LIMIT` characters; a cut text ends with an ellipsis. */
export function clipText(text: string, limit = AUDIT_TEXT_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
