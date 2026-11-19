import type { IncomingMessage } from 'node:http';

import { serverHostAllowed, serverOriginAllowed } from './auth/proxy.ts';
import type { ServerGate } from './auth/routes.ts';
import { panel } from './errors.ts';
import { cookieToken, hostAllowed, sameToken } from './http.ts';

/** The local panel answers only its own host and origin. */
export function assertLocalHost(incoming: IncomingMessage, port: number): void {
  if (!hostAllowed(incoming, port)) throw panel('forbidden', 'forbidden host or origin');
}

/** The access token of the local panel, in the header or in the cookie; nothing to check without one. */
export function assertToken(incoming: IncomingMessage, token: string | null): void {
  if (token === null) return;
  const given =
    (incoming.headers['x-aip-token'] as string | undefined) ?? cookieToken(incoming.headers.cookie);
  if (!sameToken(given, token)) throw panel('unauthorized', 'missing or invalid token');
}

/** Server mode: the host and the origin of `public_url`. */
export function assertServerHost(
  incoming: IncomingMessage,
  gate: ServerGate,
  exempt = false,
  skipOrigin = false,
): void {
  if (!serverHostAllowed(incoming, gate.options)) throw panel('forbidden', 'forbidden host');
  if (!skipOrigin && !serverOriginAllowed(incoming, gate.options, exempt)) {
    throw panel('forbidden', 'forbidden origin');
  }
}

/** Who a long connection works for, and whether it may go on. */
export interface ConnectionIdentity {
  /** The user of server mode; undefined for the local panel. */
  actor: string | undefined;
  /** Looks at the access again; false once it is gone. Null when nothing can change. */
  recheck: (() => Promise<boolean>) | null;
}

/** The checks of a request of the API, for a request that opens a long connection. */
export async function connectionIdentity(
  access: { token: string | null; gate: ServerGate | null; port: number },
  incoming: IncomingMessage,
): Promise<ConnectionIdentity> {
  const { gate } = access;
  if (gate === null) {
    assertLocalHost(incoming, access.port);
    assertToken(incoming, access.token);
    return { actor: undefined, recheck: null };
  }
  assertServerHost(incoming, gate);
  const user = await gate.auth.identify(incoming);
  if (user === null) throw panel('unauthorized', 'sign in or send a personal token');
  return {
    actor: user.id,
    recheck: async () => (await gate.auth.identify(incoming)) !== null,
  };
}
