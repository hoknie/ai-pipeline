import type { ConnectionView, IntegrationTypeView } from '../../ipc/contract/index.ts';

import { type Style, plainStyle } from '../style.ts';
import { table } from '../table.ts';
import { formatChannelState } from '../notifications/index.ts';

/** The kinds this build supports; an empty catalog says so. */
export function formatIntegrationTypes(
  types: readonly IntegrationTypeView[],
  style: Style = plainStyle,
): string {
  if (types.length === 0) return 'No integration kinds are built into this version.';
  return table(
    [
      ['KIND', 'PARAMETERS', 'SECRETS', 'DIRECTIONS'],
      ...types.map((type) => [
        style.argument(type.kind),
        type.params.map((param) => (param.required ? `${param.name}*` : param.name)).join(', ') ||
          '—',
        type.secrets
          .map((secret) => (secret.required ? `${secret.slot}*` : secret.slot))
          .join(', ') || '—',
        type.directions.join(', '),
      ]),
    ],
    style,
  );
}

function stateOf(connection: ConnectionView): string {
  if (connection.state === 'cleanup_pending') return 'removing (repeat the removal)';
  if (connection.pending) return 'pending (restart or retry)';
  return connection.enabled ? 'enabled' : 'disabled';
}

/** The outcome of the last check: when it ran, whether it passed, the count or the static code. */
export function formatCheck(check: ConnectionView['lastCheck']): string {
  if (check === null) return '—';
  const when = new Date(check.at).toISOString().slice(0, 16).replace('T', ' ');
  const what = check.ok
    ? `ok${check.count === null ? '' : `, ${check.count} tools`}`
    : `failed: ${check.code ?? 'unknown'}`;
  return `${what} (${when})`;
}

/** The answer of `integration check`: one line, never a response text. */
export function formatCheckResult(connection: ConnectionView): string {
  const check = connection.lastCheck;
  if (check === null) return `No check result for ${connection.id}`;
  if (check.ok) return `ok${check.count === null ? '' : `, ${check.count} tools`}`;
  return `failed: ${check.code ?? 'unknown'}`;
}

/** The connections with the presence of their secrets, never the values. */
export function formatConnections(
  connections: readonly ConnectionView[],
  style: Style = plainStyle,
): string {
  if (connections.length === 0) return 'No integration connections yet.';
  return table(
    [
      ['ID', 'KIND', 'NAME', 'SCOPE', 'STATE', 'PARAMS', 'SECRETS', 'CHANNEL', 'CHECK'],
      ...connections.map((connection) => [
        style.argument(connection.id),
        connection.kind,
        connection.name,
        connection.project ?? 'global',
        stateOf(connection),
        Object.entries(connection.params)
          .map(([name, value]) => `${name}=${value}`)
          .join(' ') || '—',
        connection.secrets
          .map((secret) => `${secret.slot}:${secret.present ? 'set' : 'missing'}`)
          .join(' ') || '—',
        formatChannelState(connection.channel),
        formatCheck(connection.lastCheck),
      ]),
    ],
    style,
  );
}
