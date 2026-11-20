import { crc32, inflateRawSync } from 'node:zlib';

import { invalid } from '../errors/index.ts';

export interface ZipLimits {
  /** The most files in an archive. */
  maxFiles: number;
  /** The largest file once unpacked. */
  maxFileBytes: number;
  /** The most all files take once unpacked. */
  maxTotalBytes: number;
  /** The highest ratio of the unpacked size to the packed size of a file. */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxFiles: 500,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxRatio: 200,
};

export interface ZipFile {
  /** The path inside the archive, `/` separated, never absolute and never with `..`. */
  path: string;
  data: Buffer;
}

const CODE = 'archive.invalid';

function refuse(reason: string): never {
  throw invalid(CODE, `invalid archive: ${reason}`);
}

const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const END_SIZE = 22;

function endOfDirectory(bytes: Buffer): number {
  const lowest = Math.max(0, bytes.length - END_SIZE - 0xffff);
  for (let at = bytes.length - END_SIZE; at >= lowest; at -= 1) {
    if (bytes.readUInt32LE(at) === END_OF_DIRECTORY) return at;
  }
  return refuse('no central directory');
}

/** A name that stays inside the folder it is unpacked into, or the reason it does not. */
function pathProblem(name: string): string | null {
  if (name === '' || name.includes('\0')) return 'empty or binary name';
  if (name.includes('\\')) return 'backslash in a path';
  if (name.startsWith('/') || /^[A-Za-z]:/u.test(name)) return 'absolute path';
  const parts = name.replace(/\/$/u, '').split('/');
  if (parts.some((part) => part === '..' || part === '.' || part === '')) {
    return 'path with . or .. or an empty part';
  }
  return null;
}

interface Entry {
  name: string;
  method: number;
  crc: number;
  packed: number;
  size: number;
  offset: number;
}

function readEntries(bytes: Buffer, limits: ZipLimits): Entry[] {
  const end = endOfDirectory(bytes);
  if (end >= 20 && bytes.readUInt32LE(end - 20) === ZIP64_LOCATOR) refuse('zip64 is not supported');
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const start = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) {
    refuse('zip64 is not supported');
  }
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) {
    refuse('multi-disk archives are not supported');
  }
  if (count > limits.maxFiles) refuse(`more than ${limits.maxFiles} files`);
  if (start + size > end) refuse('the central directory is out of bounds');
  const entries: Entry[] = [];
  let at = start;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== CENTRAL_ENTRY)
      refuse('broken central directory');
    const made = bytes.readUInt16LE(at + 4);
    const flags = bytes.readUInt16LE(at + 8);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const attributes = bytes.readUInt32LE(at + 38);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end) refuse('broken central directory');
    if ((flags & 1) !== 0) refuse('encrypted files are not supported');
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    const packed = bytes.readUInt32LE(at + 20);
    const unpacked = bytes.readUInt32LE(at + 24);
    const offset = bytes.readUInt32LE(at + 42);
    if (packed === 0xffffffff || unpacked === 0xffffffff || offset === 0xffffffff) {
      refuse('zip64 is not supported');
    }
    // the high half of the attributes is the Unix mode when the archive was made on Unix
    const mode = made >> 8 === 3 ? attributes >>> 16 : 0;
    if ((mode & 0o170000) === 0o120000) refuse('symbolic links are not allowed');
    entries.push({
      name,
      method: bytes.readUInt16LE(at + 10),
      crc: bytes.readUInt32LE(at + 16),
      packed,
      size: unpacked,
      offset,
    });
    at = next;
  }
  return entries;
}

function unpack(bytes: Buffer, entry: Entry, limits: ZipLimits): Buffer {
  if (entry.size > limits.maxFileBytes) refuse(`file ${entry.name} is too large`);
  if (entry.offset + 30 > bytes.length || bytes.readUInt32LE(entry.offset) !== LOCAL_ENTRY) {
    refuse('broken local header');
  }
  const from =
    entry.offset +
    30 +
    bytes.readUInt16LE(entry.offset + 26) +
    bytes.readUInt16LE(entry.offset + 28);
  if (from + entry.packed > bytes.length) refuse('file data is out of bounds');
  const packed = bytes.subarray(from, from + entry.packed);
  let data: Buffer;
  if (entry.method === 0) {
    if (entry.packed !== entry.size) refuse('sizes of a stored file differ');
    data = Buffer.from(packed);
  } else if (entry.method === 8) {
    if (entry.size > limits.maxRatio * Math.max(entry.packed, 1)) {
      refuse(`file ${entry.name} is packed too well`);
    }
    try {
      data = inflateRawSync(packed, { maxOutputLength: Math.max(entry.size, 1) });
    } catch {
      return refuse(`file ${entry.name} cannot be unpacked`);
    }
  } else {
    return refuse(`compression method ${entry.method} is not supported`);
  }
  if (data.length !== entry.size) refuse(`file ${entry.name} has a wrong size`);
  if (crc32(data) !== entry.crc) refuse(`file ${entry.name} has a wrong checksum`);
  return data;
}

/**
 * The files of a zip archive held in memory. Only stored and deflated files are read; zip64,
 * encryption, links, duplicates and paths that leave the folder are refused, as are files that
 * exceed the limits. Nothing is written anywhere.
 */
export function readZip(bytes: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipFile[] {
  if (bytes.length < END_SIZE) refuse('too short');
  const files: ZipFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const entry of readEntries(bytes, limits)) {
    const problem = pathProblem(entry.name);
    if (problem !== null) refuse(problem);
    const isDirectory = entry.name.endsWith('/');
    const path = isDirectory ? entry.name.slice(0, -1) : entry.name;
    if (seen.has(path)) refuse(`duplicate path ${path}`);
    seen.add(path);
    if (isDirectory) continue;
    total += entry.size;
    if (total > limits.maxTotalBytes) refuse('the files are too large together');
    files.push({ path, data: unpack(bytes, entry, limits) });
  }
  return files;
}
