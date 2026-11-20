import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** One accepted WebSocket connection, seen from the server side. */
export interface WsPeer {
  /** The text messages of the client, in order. */
  received: string[];
  /** The payloads of the pongs of the client. */
  pongs: string[];
  /** The code of the close frame of the client, once it came. */
  closedBy: number | null;
  /** Whether every frame of the client was masked. */
  allMasked: boolean;
  closed: boolean;
  /** While set, pings of the client are not answered. */
  silent: boolean;
  sendText(text: string): void;
  /** A message in several frames: the first is text, the rest continue it. */
  sendFragments(parts: string[]): void;
  /** Control frames may sit between fragments. */
  sendFrame(opcode: number, payload: Buffer, fin?: boolean): void;
  ping(payload?: string): void;
  close(code?: number): void;
  destroy(): void;
  raw: Duplex;
}

/** An unmasked frame, as a server sends it. */
export function serverFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const length = payload.byteLength;
  const first = (fin ? 0x80 : 0) | opcode;
  const head =
    length < 126
      ? Buffer.from([first, length])
      : length < 65536
        ? Buffer.from([first, 126, length >> 8, length & 0xff])
        : (() => {
            const big = Buffer.alloc(10);
            big[0] = first;
            big[1] = 127;
            big.writeBigUInt64BE(BigInt(length), 2);
            return big;
          })();
  return Buffer.concat([head, payload]);
}

/** Answers the upgrade of `request` and gives the peer; `handshake` may spoil the accept key. */
export function acceptWebSocket(
  request: IncomingMessage,
  socket: Duplex,
  options: { badAccept?: boolean } = {},
): WsPeer {
  const key = String(request.headers['sec-websocket-key']);
  const accept = createHash('sha1')
    .update(key + GUID)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${options.badAccept === true ? 'wrong' : accept}\r\n\r\n`,
  );
  const peer: WsPeer = {
    received: [],
    pongs: [],
    closedBy: null,
    allMasked: true,
    closed: false,
    silent: false,
    raw: socket,
    sendText: (text) => socket.write(serverFrame(0x1, Buffer.from(text))),
    sendFragments: (parts) =>
      parts.forEach((part, at) =>
        socket.write(serverFrame(at === 0 ? 0x1 : 0x0, Buffer.from(part), at === parts.length - 1)),
      ),
    sendFrame: (opcode, payload, fin = true) => socket.write(serverFrame(opcode, payload, fin)),
    ping: (payload = '') => socket.write(serverFrame(0x9, Buffer.from(payload))),
    close: (code = 1000) => {
      const body = Buffer.alloc(2);
      body.writeUInt16BE(code, 0);
      socket.write(serverFrame(0x8, body));
    },
    destroy: () => socket.destroy(),
  };
  let buffer: Buffer = Buffer.alloc(0);
  let text: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0]! & 0x80) !== 0;
      const opcode = buffer[0]! & 0x0f;
      const masked = (buffer[1]! & 0x80) !== 0;
      let length = buffer[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      if (mask === null) peer.allMasked = false;
      else
        for (let at = 0; at < payload.length; at += 1) payload[at] = payload[at]! ^ mask[at % 4]!;
      if (opcode === 0x1 || opcode === 0x0) {
        text.push(payload);
        if (fin) {
          peer.received.push(Buffer.concat(text).toString('utf8'));
          text = [];
        }
      } else if (opcode === 0x9) {
        if (!peer.silent) socket.write(serverFrame(0xa, payload));
      } else if (opcode === 0xa) {
        peer.pongs.push(payload.toString('utf8'));
      } else if (opcode === 0x8) {
        peer.closedBy = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        socket.write(serverFrame(0x8, payload.subarray(0, 2)));
        socket.end();
      }
    }
  });
  socket.on('close', () => void (peer.closed = true));
  socket.on('error', () => undefined);
  return peer;
}
