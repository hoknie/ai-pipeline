import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type WebSocket } from 'ws';

import type { ConnectionIdentity } from '../access.ts';
import { panel, renderPanelError } from '../errors.ts';

import { MAX_MESSAGE_BYTES, parseClientMessage, type LiveClient } from './protocol.ts';
import type { Topics } from './topics.ts';

export const LIVE_PATH = '/api/ws';
/** How often a connection is pinged; one that did not answer the last ping is closed. */
export const PING_MS = 15_000;
/** How often the access of a connection is looked at again in server mode. */
export const RECHECK_ACCESS_MS = 60_000;
/** A connection with more than this waiting to be sent does not keep up and is closed. */
const BUFFER_LIMIT = 8 * 1024 * 1024;
/** The close code of a connection whose access is gone. */
const ACCESS_GONE = 4401;

export interface LiveOptions {
  /** The checks of a request of the API; throws the error the request would get. */
  identify(incoming: IncomingMessage): Promise<ConnectionIdentity>;
  /** Adds a connection to the events of the daemon; returns the function that removes it. */
  join(send: (text: string) => void): () => void;
  topics: Topics;
  pingMs?: number;
  recheckMs?: number;
}

/** Answers a request that may not open a connection, with the status a request of the API gets. */
function refuse(socket: Duplex, error: unknown): void {
  const { status, body } = renderPanelError(error);
  const text = JSON.stringify(body);
  socket.end(
    `HTTP/1.1 ${status} Refused\r\ncontent-type: application/json; charset=utf-8\r\n` +
      `content-length: ${Buffer.byteLength(text)}\r\nconnection: close\r\n\r\n${text}`,
  );
}

/** One open connection: the events, the subscriptions, the ping and the access check. */
function serve(ws: WebSocket, identity: ConnectionIdentity, options: LiveOptions): void {
  const sendText = (text: string): void => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > BUFFER_LIMIT) ws.terminate();
    else ws.send(text);
  };
  const client: LiveClient = {
    actor: identity.actor,
    send: (message) => sendText(JSON.stringify(message)),
  };
  const leave = options.join(sendText);
  let alive = true;
  ws.on('pong', () => {
    alive = true;
  });
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, options.pingMs ?? PING_MS);
  const recheck = identity.recheck;
  const access =
    recheck === null
      ? null
      : setInterval(() => {
          void recheck().then(
            (allowed) => {
              if (!allowed) ws.close(ACCESS_GONE, 'access is gone');
            },
            () => undefined, // the daemon did not answer; the next check decides
          );
        }, options.recheckMs ?? RECHECK_ACCESS_MS);
  ws.on('message', (data, binary) => {
    if (binary) return;
    const message = parseClientMessage(String(data));
    if ('event' in message) client.send(message);
    else options.topics.handle(client, message);
  });
  ws.on('error', () => undefined);
  ws.on('close', () => {
    clearInterval(ping);
    if (access) clearInterval(access);
    leave();
    options.topics.drop(client);
  });
}

/** Serves the live connection of the panel on the HTTP server; returns the function that stops it. */
export function serveLive(server: Server, options: LiveOptions): () => void {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on('upgrade', (incoming, socket, head) => {
    socket.on('error', () => undefined);
    const path = new URL(incoming.url ?? '/', 'http://panel').pathname;
    Promise.resolve()
      .then(() => {
        if (path !== LIVE_PATH) throw panel('not_found', 'not found');
        return options.identify(incoming);
      })
      .then(
        (identity) =>
          sockets.handleUpgrade(incoming, socket, head, (ws) => serve(ws, identity, options)),
        (error: unknown) => refuse(socket, error),
      );
  });
  return () => {
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
    options.topics.stop();
  };
}
