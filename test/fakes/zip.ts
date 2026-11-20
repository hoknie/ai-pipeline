import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipSource {
  name: string;
  data?: string | Buffer;
  /** 0 stored, 8 deflate (default 8); other numbers are written as they are. */
  method?: number;
  /** The Unix mode in the attributes, for example `0o120777` for a link. */
  mode?: number;
}

export interface ZipOptions {
  zip64?: boolean;
}

/** A zip archive built in memory, for the tests of the reader and the fake registry. */
export function buildZip(sources: ZipSource[], options: ZipOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const source of sources) {
    const raw = Buffer.from(source.data ?? '');
    const method = source.method ?? 8;
    const packed = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(source.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((source.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.zip64 ? 0xffff : sources.length, 8);
  end.writeUInt16LE(options.zip64 ? 0xffff : sources.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
