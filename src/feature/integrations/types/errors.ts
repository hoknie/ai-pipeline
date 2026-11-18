import { appError, type AppError, type ErrorKind } from '../../../platform/errors/index.ts';

/** Every refusal of the integrations: a fixed code and a fixed text, never a part of an input. */
const REFUSALS = {
  unknown_kind: ['invalid', 'unknown integration kind'],
  invalid_name: ['invalid', 'invalid connection name'],
  invalid_params: ['invalid', 'invalid connection parameters'],
  invalid_slot: ['invalid', 'unknown secret slot of the connection kind'],
  invalid_secret: ['invalid', 'secret value is empty or too long'],
  scope_required: ['invalid', 'choose either one project or the shared scope explicitly'],
  unknown_project: ['rejected', 'project is not registered'],
  name_taken: ['conflict', 'a connection with this kind and name already exists in the scope'],
  not_found: ['not_found', 'connection not found'],
  no_secret: ['rejected', 'the connection has no such secret'],
  missing_secret: ['rejected', 'a required secret of the connection is not set'],
  operation_pending: ['conflict', 'a secret operation of the connection is not finished; retry'],
  cleanup_pending: ['conflict', 'connection cleanup is not finished; run the removal again'],
  project_has_connections: [
    'rejected',
    'the project still has integration connections; remove them first',
  ],
  scope_denied: ['forbidden', 'the connection does not apply to this project'],
  disabled: ['forbidden', 'the connection is disabled or not ready'],
  backend_unavailable: ['unavailable', 'secret storage is unavailable'],
  backend_failed: ['unavailable', 'secret storage failed; the operation is recoverable'],
  too_large: ['too_large', 'event is too large'],
  unauthenticated: ['unauthorized', 'event authentication failed'],
  operation_denied: ['forbidden', 'operation is not allowed for this connection'],
  internal: ['internal', 'integration request failed'],
  timeout: ['unavailable', 'operation timed out; the outcome is unknown'],
} as const satisfies Record<string, readonly [ErrorKind, string]>;

export type IntegrationFailure = keyof typeof REFUSALS;

/**
 * A refusal with the static text of its code. `detail` is a name the kind itself declares (a
 * parameter or a secret slot), never a value the caller sent.
 */
export function refusal(code: IntegrationFailure, detail?: string): AppError {
  const [kind, text] = REFUSALS[code];
  return appError(kind, `integrations.${code}`, detail === undefined ? text : `${text}: ${detail}`);
}

export function failureCode(error: unknown): IntegrationFailure | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !code.startsWith('integrations.')) return null;
  const name = code.slice('integrations.'.length);
  return name in REFUSALS ? (name as IntegrationFailure) : null;
}
