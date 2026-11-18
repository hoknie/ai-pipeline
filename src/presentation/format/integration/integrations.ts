import type { ConnectionView, IntegrationTypeView } from '../../ipc/contract/index.ts';

import { type Style, plainStyle } from '../style.ts';
import { table } from '../table.ts';

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

/** The connections with the presence of their secrets, never the values. */
export function formatConnections(
  connections: readonly ConnectionView[],
  style: Style = plainStyle,
): string {
  if (connections.length === 0) return 'No integration connections yet.';
  return table(
    [
      ['ID', 'KIND', 'NAME', 'SCOPE', 'STATE', 'SECRETS'],
      ...connections.map((connection) => [
        style.argument(connection.id),
        connection.kind,
        connection.name,
        connection.project ?? 'global',
        stateOf(connection),
        connection.secrets
          .map((secret) => `${secret.slot}:${secret.present ? 'set' : 'missing'}`)
          .join(' ') || '—',
      ]),
    ],
    style,
  );
}
