import { randomBytes } from 'node:crypto';

/** One frame of RFC 6455 as it came, with the mask already removed. */
export interface Frame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

export const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
};

/** A violation of the protocol or of the limits: the code to close the connection with. */
export class FrameError extends Error {
  readonly code: number;

  constructor(code: number, reason: string) {
    super(reason);
    this.name = 'FrameError';
    this.code = code;
  }
}

/** A masked client frame. */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.byteLength;
  let head: Buffer;
  if (length < 126) {
    head = Buffer.from([0x80 | opcode, 0x80 | length]);
  } else if (length < 65536) {
    head = Buffer.from([0x80 | opcode, 0x80 | 126, length >> 8, length & 0xff]);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }
  const mask = randomBytes(4);
  const body = Buffer.alloc(length);
  for (let at = 0; at < length; at += 1) body[at] = payload[at]! ^ mask[at % 4]!;
  return Buffer.concat([head, mask, body]);
}

/** The payload of a close frame: the code and a short reason. */
export function closePayload(code: number, reason = ''): Buffer {
  const body = Buffer.alloc(2 + Buffer.byteLength(reason));
  body.writeUInt16BE(code, 0);
  body.write(reason, 2);
  return body;
}

/** Cuts the bytes of the socket into frames; a frame over the limit is refused before it is read. */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  /** The whole frames of what has come so far; the error is that of the frame after them. */
  push(chunk: Buffer): { frames: Frame[]; error: FrameError | null } {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Frame[] = [];
    try {
      for (let frame = this.next(); frame !== null; frame = this.next()) frames.push(frame);
    } catch (error) {
      if (error instanceof FrameError) return { frames, error };
      throw error;
    }
    return { frames, error: null };
  }

  private next(): Frame | null {
    const buffer = this.buffer;
    if (buffer.length < 2) return null;
    const first = buffer[0]!;
    const second = buffer[1]!;
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return null;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return null;
      const big = buffer.readBigUInt64BE(2);
      if (big > BigInt(this.limit)) throw new FrameError(1009, 'message too big');
      length = Number(big);
      offset = 10;
    }
    if ((first & 0x70) !== 0) throw new FrameError(1002, 'reserved bits are set');
    if (opcode >= 0x8 && (!fin || length > 125)) throw new FrameError(1002, 'bad control frame');
    if (length > this.limit) throw new FrameError(1009, 'message too big');
    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    if (masked) offset += 4;
    if (buffer.length < offset + length) return null;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    this.buffer = buffer.subarray(offset + length);
    if (mask !== null) {
      for (let at = 0; at < payload.length; at += 1) payload[at] = payload[at]! ^ mask[at % 4]!;
    }
    return { fin, opcode, payload };
  }
}

/** Puts the fragments of a text message together; the whole message stays under the limit. */
export class MessageAssembler {
  private parts: Buffer[] = [];
  private bytes = 0;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  /** The text when the frame completes a message; null while fragments are still coming. */
  add(frame: Frame): string | null {
    const { opcode } = frame;
    if (opcode === OPCODE.continuation) {
      if (this.parts.length === 0) throw new FrameError(1002, 'unexpected continuation');
    } else if (opcode === OPCODE.text) {
      if (this.parts.length > 0)
        throw new FrameError(1002, 'a new message inside a fragmented one');
    } else {
      throw new FrameError(1003, 'only text messages are supported');
    }
    this.bytes += frame.payload.byteLength;
    if (this.bytes > this.limit) throw new FrameError(1009, 'message too big');
    this.parts.push(frame.payload);
    if (!frame.fin) return null;
    const whole = Buffer.concat(this.parts);
    this.parts = [];
    this.bytes = 0;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(whole);
    } catch {
      throw new FrameError(1007, 'invalid text');
    }
  }
}
