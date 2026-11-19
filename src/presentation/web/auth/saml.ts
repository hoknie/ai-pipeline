import type { IncomingMessage, ServerResponse } from 'node:http';

import { IpcError } from '../../ipc/client/index.ts';
import { panel } from '../errors.ts';
import { send } from '../http.ts';
import { call, cookie, redirect, statusOf, type ServerGate } from './gate.ts';
import { clientAddress } from './proxy.ts';
import { errorPage } from './pages.ts';

/** A SAML response with its assertions and signatures is large; the form of the ACS may be this big. */
const ACS_LIMIT = 1_000_000;

const NOT_READY = ['identity.saml_unavailable', 'identity.saml_not_configured'];

function failure(response: ServerResponse, error: unknown): void {
  const notReady = error instanceof IpcError && NOT_READY.includes(error.remoteCode ?? '');
  errorPage(response, notReady ? 503 : statusOf(error), (error as Error).message);
}

async function readForm(incoming: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > ACS_LIMIT) throw panel('too_large', 'request body is too large');
    chunks.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

/** `GET /auth/saml/start`: to the provider with a signed request. */
export async function samlStart(
  gate: ServerGate,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  try {
    const returnTo = url.searchParams.get('returnTo') ?? undefined;
    const { url: target } = (await call(gate, 'auth_saml_begin', { returnTo })) as { url: string };
    redirect(response, target);
  } catch (error) {
    failure(response, error);
  }
}

/**
 * `POST /auth/saml/acs`: the answer of the provider, posted by the browser from the site of the
 * provider (so without the `Origin` of the panel); the daemon checks everything that matters.
 */
export async function samlAcs(
  gate: ServerGate,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const form = await readForm(incoming);
    const result = (await call(gate, 'auth_saml_complete', {
      samlResponse: form.SAMLResponse ?? '',
      relayState: form.RelayState ?? '',
      address: clientAddress(incoming, gate.options),
    })) as { session: string; expiresAt: number; returnTo: string };
    const age = Math.max(1, Math.floor((result.expiresAt - Date.now()) / 1000));
    redirect(response, result.returnTo, { 'set-cookie': cookie(gate, result.session, age) });
  } catch (error) {
    failure(response, error);
  }
}

/** `GET /auth/saml/metadata`: the metadata of the service, open to everybody. */
export async function samlMetadata(gate: ServerGate, response: ServerResponse): Promise<void> {
  try {
    const { xml } = (await call(gate, 'auth_saml_metadata', {})) as { xml: string };
    send(response, 200, xml, 'application/samlmetadata+xml');
  } catch (error) {
    failure(response, error);
  }
}
