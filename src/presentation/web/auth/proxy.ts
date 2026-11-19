import type { IncomingMessage } from 'node:http';

/** What server mode needs to know about the external address of the panel. */
export interface ServerModeOptions {
  /** `server.public_url` without a trailing slash. */
  publicUrl: string;
  /** Addresses whose `X-Forwarded-*` headers are trusted. */
  trustedProxies: string[];
}

/** The IP address of the peer: IPv4-mapped IPv6 addresses are shown as IPv4. */
export function peerAddress(incoming: IncomingMessage): string {
  const address = incoming.socket.remoteAddress ?? '';
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

/** The address of the client: the first `X-Forwarded-For` entry from a trusted proxy, else the peer. */
export function clientAddress(incoming: IncomingMessage, server: ServerModeOptions): string {
  const forwarded = fromTrustedProxy(incoming, server)
    ? first(incoming.headers['x-forwarded-for'])
    : undefined;
  return (forwarded ?? peerAddress(incoming)).slice(0, 64);
}

export function fromTrustedProxy(incoming: IncomingMessage, server: ServerModeOptions): boolean {
  return server.trustedProxies.includes(peerAddress(incoming));
}

function first(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return text?.split(',')[0]?.trim() || undefined;
}

/** The host the client asked for: `X-Forwarded-Host` only from a trusted proxy. */
export function requestedHost(incoming: IncomingMessage, server: ServerModeOptions): string {
  const forwarded = fromTrustedProxy(incoming, server)
    ? first(incoming.headers['x-forwarded-host'])
    : undefined;
  return (forwarded ?? incoming.headers.host ?? '').toLowerCase();
}

/** `Host` (or the forwarded one) is the host and port of `public_url`. */
export function serverHostAllowed(incoming: IncomingMessage, server: ServerModeOptions): boolean {
  const given = requestedHost(incoming, server);
  return given !== '' && given === new URL(server.publicUrl).host.toLowerCase();
}

export function isSecure(server: ServerModeOptions): boolean {
  return server.publicUrl.startsWith('https://');
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A request that changes state names the origin of `public_url`; a request with a bearer token
 * and no `Origin` (the CLI) passes.
 */
export function serverOriginAllowed(
  incoming: IncomingMessage,
  server: ServerModeOptions,
  exempt = false,
): boolean {
  const origin = incoming.headers.origin;
  if (origin !== undefined) {
    try {
      return new URL(origin).origin === new URL(server.publicUrl).origin;
    } catch {
      return false;
    }
  }
  if (!MUTATING.has(incoming.method ?? 'GET') || exempt) return true;
  return /^bearer\s/i.test(incoming.headers.authorization ?? '');
}
