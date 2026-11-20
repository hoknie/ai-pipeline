import { appError, type AppError, type ErrorKind } from '../../../platform/errors/index.ts';

import { EVENT_KINDS } from './events.ts';

/** Every refusal of the notifications: a fixed code and a fixed text, never a part of a secret. */
const REFUSALS = {
  unknown_event: ['invalid', `unknown event kind; allowed: ${EVENT_KINDS.join(', ')}`],
  no_events: ['invalid', 'a subscription needs at least one event kind'],
  scope_required: ['invalid', 'choose either one project or all projects'],
  unknown_project: ['rejected', 'project is not registered'],
  not_found: ['not_found', 'subscription not found'],
  no_connection: ['not_found', 'connection not found'],
  not_a_channel: [
    'invalid',
    'the connection kind is not a chat channel; manage it with the commands of its own group',
  ],
  connection_disabled: ['rejected', 'the connection is disabled or incomplete'],
  scope_denied: ['forbidden', 'a project connection cannot subscribe to another project'],
  missing_param: ['rejected', 'the connection lacks a parameter the subscription needs'],
  not_enabled: ['rejected', 'enable the connection first'],
  channel_failed: ['unavailable', 'the channel did not accept the message'],
} as const satisfies Record<string, readonly [ErrorKind, string]>;

export type NotificationFailure = keyof typeof REFUSALS;

/** `detail` is a name the channel declares (a parameter), never a value of the caller. */
export function notificationRefusal(code: NotificationFailure, detail?: string): AppError {
  const [kind, text] = REFUSALS[code];
  return appError(
    kind,
    `notifications.${code}`,
    detail === undefined ? text : `${text}: ${detail}`,
  );
}

/** The code of a refusal of the notifications; null for any other failure. */
export function notificationFailureCode(error: unknown): NotificationFailure | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !code.startsWith('notifications.')) return null;
  const name = code.slice('notifications.'.length);
  return name in REFUSALS ? (name as NotificationFailure) : null;
}
