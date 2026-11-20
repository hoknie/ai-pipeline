import { createHash, randomBytes } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';

import { appError, type AppError } from '../errors/index.ts';
import { openTunnel } from '../network/tunnel.ts';

import { bypassProxy } from './request.ts';
import {
  closePayload,
  encodeFrame,
  FrameError,
  FrameReader,
  MessageAssembler,
  OPCODE,
  type Frame,
} from './websocket-frames.ts';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CLOSE_WAIT_MS = 2000;
const HANDSHAKE_LIMIT = 16 * 1024;

/** Every failure of the connection: a fixed code and text, never the address (it may hold a ticket). */
const FAILURES = {
  invalid_url: ['invalid', 'the address is not a valid WebSocket URL'],
  unsupported_scheme: ['invalid', 'only ws and wss addresses are supported'],
  timeout: ['unavailable', 'the WebSocket connection timed out'],
  proxy_refused: ['unavailable', 'the proxy refused the connection'],
  aborted: ['unavailable', 'the WebSocket connection was cancelled'],
  handshake: ['unavailable', 'the server did not accept the WebSocket upgrade'],
  network: ['unavailable', 'the WebSocket connection failed'],
} as const;

export type WebSocketFailure = keyof typeof FAILURES;

function failure(code: WebSocketFailure, errno?: string): AppError {
  const [kind, text] = FAILURES[code];
  return appError(kind, `websocket.${code}`, errno === undefined ? text : `${text} (${errno})`);
}

/** The code of a failure of `openWebSocket`; null for any other error. */
export function webSocketFailureCode(error: unknown): WebSocketFailure | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !code.startsWith('websocket.')) return null;
  const name = code.slice('websocket.'.length);
  return name in FAILURES ? (name as WebSocketFailure) : null;
}

/** How the connection ended: the code of the close frame, or 1006 when there was none. */
export interface WebSocketClosed {
  code: number;
  reason: string;
}

export interface WebSocketOptions {
  /** `ws://` or `wss://`. */
  url: string;
  /** An http(s) proxy that tunnels with CONNECT; loopback addresses never go through it. */
  proxy?: string | null;
  /** The connection and the handshake. */
  timeoutMs: number;
  /** Aborting closes the connection, or cancels the handshake. */
  signal?: AbortSignal;
  /** Extra certificate authority of the server: a private CA and the tests. */
  ca?: string | Buffer;
  /** The longest message (all its fragments together); default 1 MiB. */
  maxMessageBytes?: number;
  /** A text message, whole. */
  onMessage: (text: string) => void;
  onPong?: (payload: Buffer) => void;
  /** Called once, when the connection is gone for whatever reason. */
  onClose: (closed: WebSocketClosed) => void;
}

export interface WebSocketConnection {
  send(text: string): void;
  ping(payload?: string): void;
  /** Starts the closing handshake; the connection is dropped if the server does not answer. */
  close(code?: number): void;
}

export const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;

async function connectSocket(url: URL, options: WebSocketOptions): Promise<Duplex> {
  const secure = url.protocol === 'wss:';
  const port = Number(url.port || (secure ? 443 : 80));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const proxied =
    options.proxy !== undefined && options.proxy !== null && !bypassProxy(url.hostname);
  const tls = (extra: object): Duplex =>
    tlsConnect({
      servername: host,
      ...(options.ca === undefined ? {} : { ca: options.ca }),
      ...extra,
    });
  if (!proxied) return secure ? tls({ host, port }) : netConnect({ host, port });
  let tunnel: Duplex;
  try {
    tunnel = await openTunnel(new URL(options.proxy!), host, port, options.timeoutMs);
  } catch {
    throw failure('proxy_refused');
  }
  return secure ? tls({ socket: tunnel }) : tunnel;
}

/** A timer and a signal that fail the opening, and stop doing so once it is over. */
function guard(options: WebSocketOptions) {
  let release: () => void = () => undefined;
  const failed = new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => reject(failure('timeout')), options.timeoutMs);
    const onAbort = (): void => reject(failure('aborted'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    release = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };
  });
  failed.catch(() => undefined);
  return { failed, release };
}

/** Sends the upgrade request and reads the answer; the bytes after it already belong to frames. */
function handshake(socket: Duplex, url: URL, setHandler: (on: (chunk: Buffer) => void) => void) {
  const key = randomBytes(16).toString('base64');
  const expected = createHash('sha1')
    .update(key + GUID)
    .digest('base64');
  return new Promise<Buffer>((resolve, reject) => {
    let head = '';
    setHandler((chunk) => {
      head += chunk.toString('latin1');
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) {
        if (head.length > HANDSHAKE_LIMIT) reject(failure('handshake'));
        return;
      }
      const lines = head.slice(0, end).split('\r\n');
      const headers = new Map<string, string>();
      for (const line of lines.slice(1)) {
        const at = line.indexOf(':');
        if (at > 0) headers.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
      }
      const accepted =
        /^HTTP\/1\.1 101\b/.test(lines[0] ?? '') &&
        headers.get('upgrade')?.toLowerCase() === 'websocket' &&
        headers.get('sec-websocket-accept') === expected;
      if (accepted) resolve(Buffer.from(head.slice(end + 4), 'latin1'));
      else reject(failure('handshake'));
    });
    const host = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`;
    socket.write(
      `GET ${url.pathname || '/'}${url.search} HTTP/1.1\r\nHost: ${host}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n',
    );
  });
}

/** An open connection: frames in, frames out, the closing handshake. */
class Session implements WebSocketConnection {
  private readonly socket: Duplex;
  private readonly options: WebSocketOptions;
  private readonly reader: FrameReader;
  private readonly assembler: MessageAssembler;
  private closing = false;
  private closed = false;
  private closeInfo: WebSocketClosed | null = null;
  private closeTimer: NodeJS.Timeout | null = null;
  private readonly onAbort = (): void => this.close(1000);

  constructor(socket: Duplex, options: WebSocketOptions) {
    const limit = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.socket = socket;
    this.options = options;
    this.reader = new FrameReader(limit);
    this.assembler = new MessageAssembler(limit);
    options.signal?.addEventListener('abort', this.onAbort, { once: true });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.finish());
  }

  send(text: string): void {
    if (!this.closing) this.write(OPCODE.text, Buffer.from(text, 'utf8'));
  }

  ping(payload = ''): void {
    if (!this.closing) this.write(OPCODE.ping, Buffer.from(payload, 'utf8'));
  }

  close(code = 1000, reason = ''): void {
    if (this.closing) return;
    this.closing = true;
    this.closeInfo ??= { code, reason };
    this.write(OPCODE.close, closePayload(code, reason));
    this.closeTimer = setTimeout(() => this.socket.destroy(), CLOSE_WAIT_MS);
  }

  /** The bytes that came from the socket. */
  receive(chunk: Buffer): void {
    const { frames, error } = this.reader.push(chunk);
    try {
      for (const frame of frames) this.frame(frame);
    } catch (thrown) {
      if (!(thrown instanceof FrameError)) throw thrown;
      return this.fault(thrown);
    }
    if (error !== null) this.fault(error);
  }

  private write(opcode: number, payload: Buffer): void {
    if (this.socket.destroyed || !this.socket.writable) return;
    this.socket.write(encodeFrame(opcode, payload));
  }

  /** A protocol violation or a message over the limit: say why and drop the connection. */
  private fault(error: FrameError): void {
    this.close(error.code, error.message);
    this.socket.end();
  }

  private frame(frame: Frame): void {
    const { opcode, payload } = frame;
    if (opcode === OPCODE.close) return this.answerClose(payload);
    if (this.closing) return;
    if (opcode === OPCODE.ping) return this.write(OPCODE.pong, payload);
    if (opcode === OPCODE.pong) return this.options.onPong?.(payload);
    const text = this.assembler.add(frame);
    if (text !== null) this.options.onMessage(text);
  }

  private answerClose(payload: Buffer): void {
    const code = payload.byteLength >= 2 ? payload.readUInt16BE(0) : 1005;
    this.closeInfo ??= { code, reason: payload.subarray(2).toString('utf8') };
    if (!this.closing) {
      this.closing = true;
      this.write(OPCODE.close, payload.subarray(0, 2));
    }
    this.socket.end();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.options.signal?.removeEventListener('abort', this.onAbort);
    this.options.onClose(this.closeInfo ?? { code: 1006, reason: '' });
  }
}

function parseUrl(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw failure('invalid_url');
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw failure('unsupported_scheme');
  return url;
}

/**
 * Opens a WebSocket (RFC 6455, client side, text messages): the handshake over the same kinds of
 * connection `httpRequest` uses (a tunnel of the proxy, TLS on top for `wss`), masked frames,
 * fragments put together, ping answered, a message over the limit refused with 1009.
 */
export async function openWebSocket(options: WebSocketOptions): Promise<WebSocketConnection> {
  const url = parseUrl(options.url);
  if (options.signal?.aborted === true) throw failure('aborted');
  const control = guard(options);
  let socket: Duplex | null = null;
  let abandoned = false;
  const connecting = connectSocket(url, options);
  // A connection that comes up after the opening was given up is not left open.
  connecting.then(
    (late) => abandoned && late.destroy(),
    () => undefined,
  );
  try {
    socket = await Promise.race([connecting, control.failed]);
    let onData: (chunk: Buffer) => void = () => undefined;
    socket.on('data', (chunk: Buffer) => onData(chunk));
    const dropped = new Promise<never>((_resolve, reject) => {
      socket!.once('error', (error: Error & { code?: string }) =>
        reject(failure('network', error.code)),
      );
      socket!.once('close', () => reject(failure('network')));
    });
    dropped.catch(() => undefined);
    const rest = await Promise.race([
      handshake(socket, url, (handler) => (onData = handler)),
      control.failed,
      dropped,
    ]);
    control.release();
    socket.removeAllListeners('error');
    socket.removeAllListeners('close');
    const session = new Session(socket, options);
    onData = (chunk) => session.receive(chunk);
    if (rest.length > 0) session.receive(rest);
    return session;
  } catch (error) {
    abandoned = true;
    control.release();
    socket?.destroy();
    throw webSocketFailureCode(error) === null ? failure('network') : error;
  }
}
