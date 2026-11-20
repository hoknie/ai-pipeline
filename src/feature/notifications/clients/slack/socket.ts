import { openWebSocket, type WebSocketConnection } from '../../../../platform/http/index.ts';
import type { ChannelStatus } from '../../types/index.ts';

import { toFailure } from './api.ts';
import { parseEnvelope, type SlackEnvelope } from './events.ts';

/** The times of Socket Mode; the tests make them short. */
export interface SocketTiming {
  /** A ping goes out this often. */
  pingMs: number;
  /** No pong in this time: the connection is dead. */
  pongMs: number;
  /** The first pause before a new attempt; it doubles up to `maxBackoffMs`. */
  backoffMs: number;
  maxBackoffMs: number;
  /** The connection and the handshake. */
  connectMs: number;
}

export const DEFAULT_TIMING: SocketTiming = {
  pingMs: 30_000,
  pongMs: 10_000,
  backoffMs: 1000,
  maxBackoffMs: 60_000,
  connectMs: 15_000,
};

export interface SocketModeOptions {
  /** Asks Slack for the address of a new connection (`apps.connections.open`). */
  openUrl: (signal: AbortSignal) => Promise<string>;
  proxy: () => string | null;
  ca?: string | undefined;
  timing: SocketTiming;
  /** An envelope that carries an event; it is already acknowledged. */
  receive: (envelope: Exclude<SlackEnvelope, { type: 'hello' | 'disconnect' }>) => void;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

interface Session {
  /** Slack said hello: the connection worked. */
  hello: boolean;
  /** Slack asked to reconnect (`disconnect`): no pause is needed. */
  planned: boolean;
  /** The connection did not open. */
  failed: boolean;
}

/** One connection: it ends when it is closed, lost, silent, or asked to move on. */
function session(
  url: string,
  options: SocketModeOptions,
  signal: AbortSignal,
  report: (status: ChannelStatus) => void,
): Promise<Session> {
  return new Promise((resolve) => {
    const state: Session = { hello: false, planned: false, failed: false };
    let connection: WebSocketConnection | null = null;
    const pending: string[] = [];
    let pingTimer: NodeJS.Timeout | null = null;
    let pongTimer: NodeJS.Timeout | null = null;
    const stop = (): void => {
      if (pingTimer !== null) clearInterval(pingTimer);
      if (pongTimer !== null) clearTimeout(pongTimer);
      pingTimer = pongTimer = null;
    };
    const end = (): void => {
      stop();
      resolve(state);
    };
    const handle = (raw: string): void => {
      const envelope = parseEnvelope(raw);
      if (envelope === null) return;
      if (envelope.type === 'hello') {
        state.hello = true;
        report({ state: 'listening' });
        return;
      }
      if (envelope.type === 'disconnect') {
        state.planned = true;
        connection?.close(1000);
        end();
        return;
      }
      // The acknowledgement goes first: Slack redelivers what is not acknowledged in 3 seconds.
      if (envelope.envelopeId !== null) {
        connection?.send(JSON.stringify({ envelope_id: envelope.envelopeId }));
      }
      if (envelope.type !== 'other') options.receive(envelope);
    };
    openWebSocket({
      url,
      proxy: options.proxy(),
      timeoutMs: options.timing.connectMs,
      signal,
      ...(options.ca === undefined ? {} : { ca: options.ca }),
      onMessage: (text) => {
        if (connection === null) pending.push(text);
        else handle(text);
      },
      onPong: () => {
        if (pongTimer !== null) clearTimeout(pongTimer);
        pongTimer = null;
      },
      onClose: end,
    }).then(
      (opened) => {
        connection = opened;
        pingTimer = setInterval(() => {
          if (pongTimer !== null) return;
          opened.ping();
          pongTimer = setTimeout(() => opened.close(1001), options.timing.pongMs);
        }, options.timing.pingMs);
        for (const text of pending.splice(0)) handle(text);
      },
      () => {
        state.failed = true;
        end();
      },
    );
  });
}

/**
 * Socket Mode until the signal aborts: asks for an address, connects, hands over the envelopes,
 * and connects again after `disconnect`, a closed or a silent connection, with a growing pause.
 * A refused token ends it; anything else is reported and tried again.
 */
export async function runSocketMode(
  options: SocketModeOptions,
  signal: AbortSignal,
  report: (status: ChannelStatus) => void,
): Promise<void> {
  let failures = 0;
  const backoff = (): number =>
    Math.min(
      options.timing.backoffMs * 2 ** Math.max(failures - 1, 0),
      options.timing.maxBackoffMs,
    );
  while (!signal.aborted) {
    let url: string;
    try {
      url = await options.openUrl(signal);
    } catch (error) {
      if (signal.aborted) return;
      const failure = toFailure(error);
      if (failure.unauthorized) {
        report({ state: 'error', error: failure.message, unauthorized: true });
        return;
      }
      report({ state: 'error', error: failure.message, unauthorized: false });
      failures += 1;
      await pause(failure.retryAfterMs ?? backoff(), signal);
      continue;
    }
    const ended = await session(url, options, signal, report);
    if (signal.aborted) return;
    if (ended.hello) failures = 0;
    if (ended.planned) continue;
    failures += 1;
    report({
      state: 'error',
      error: ended.failed
        ? 'cannot open the connection to slack'
        : 'the connection to slack was lost',
      unauthorized: false,
    });
    await pause(backoff(), signal);
  }
}
