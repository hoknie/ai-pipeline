import type { AuditEventView } from '../../ipc/contract/index.ts';
import { type Style, plainStyle } from '../style.ts';
import { table } from '../table.ts';

/** `2026-05-01 12:30:15` in UTC: the journal is read across time zones. */
function moment(at: number): string {
  return new Date(at).toISOString().replace('T', ' ').slice(0, 19);
}

/** The resource and the details of an entry in one cell: `run r1 · group=login`. */
function subject(event: AuditEventView): string {
  const resource =
    event.resourceKind === null ? '' : `${event.resourceKind} ${event.resourceId ?? ''}`.trim();
  const details = Object.entries(event.details)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  return [resource, details].filter((part) => part !== '').join(' · ');
}

/** The journal of the audit as a table, the newest entry first; the error of a failed entry ends its line. */
export function formatAudit(events: readonly AuditEventView[], style: Style = plainStyle): string {
  if (events.length === 0) return 'No entries.';
  const rows = events.map((event) => [
    moment(event.at),
    event.user?.email ?? event.subject,
    event.action,
    event.repository ?? '—',
    event.outcome === 'ok' ? event.outcome : style.danger(event.outcome),
    [subject(event), event.error ?? ''].filter((part) => part !== '').join(' — '),
  ]);
  return table([['TIME (UTC)', 'WHO', 'ACTION', 'PROJECT', 'OUTCOME', 'WHAT'], ...rows], style);
}
