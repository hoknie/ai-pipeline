import type {
  ConnectionView,
  IntegrationTypeView,
  ProjectLinkView,
} from '../../ipc/contract/index.ts';

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

const REASONS: Record<string, string> = {
  no_match: 'no project of the registry has the origin of this project',
  ambiguous: 'several projects match; link one with --path',
  unreachable: 'the registry did not answer',
  unauthorized: 'the registry refused the token',
  truncated: 'the catalog is too large to read; link the project with --path',
  disabled: 'cleared; matching is off until --auto',
};

/** What one pair is linked to, or why it is not. */
function linkText(link: ProjectLinkView): string {
  if (link.registryPath !== null) return `${link.registryPath} (${link.source ?? 'auto'})`;
  const reason = REASONS[link.status] ?? link.status;
  const candidates = link.candidates.length > 0 ? `: ${link.candidates.join(', ')}` : '';
  return `not linked — ${link.status}: ${reason}${candidates}`;
}

/** The links of projects to the projects of service registries. */
export function formatProjectLinks(
  links: readonly ProjectLinkView[],
  style: Style = plainStyle,
): string {
  if (links.length === 0) return 'No project is linked to a service registry yet.';
  return table(
    [
      ['PROJECT', 'CONNECTION', 'REGISTRY PROJECT'],
      ...links.map((link) => [link.project, style.argument(link.connectionName), linkText(link)]),
    ],
    style,
  );
}
