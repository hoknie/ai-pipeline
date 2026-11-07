import { timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import { SLUG_PATTERN_TEXT, isValidSlug } from '../../feature/swarm-config/types/index.ts';
import type {
  ConfigEditResult,
  SpecialistTagsResult,
  SpecialistsImportResult,
} from '../ipc/contract/index.ts';

import { panel } from './errors.ts';

export const COOKIE = 'aip_token';
const BODY_LIMIT = 64 * 1024;

export const levelParam = z.enum(['project', 'global']);

/** A handler result with its own status code. */
export class Reply {
  readonly status: number;
  readonly value: unknown;
  constructor(status: number, value: unknown) {
    this.status = status;
    this.value = value;
  }
}

/** Maps the outcome of a configuration edit onto HTTP: 200, 422 for errors, 409 for a conflict. */
export function editReply(result: ConfigEditResult): Reply {
  if (result.ok) return new Reply(200, result);
  if (result.reason === 'conflict') return new Reply(409, { error: result.message });
  return new Reply(422, { errors: result.errors, references: result.references ?? [] });
}

/** Reply of a tag edit or an import: 200 with the outcome, 422 for errors, 409 for a conflict. */
export function tagReply(result: SpecialistTagsResult | SpecialistsImportResult): Reply {
  if (result.ok) return new Reply(200, result);
  if (result.reason === 'conflict') {
    return new Reply(409, { error: result.message, slugs: result.slugs ?? [] });
  }
  return new Reply(422, { errors: result.errors, references: [] });
}

export function entryId(value: string | undefined): string {
  const id = value ?? '';
  if (!isValidSlug(id)) throw panel('invalid', `id must match ${SLUG_PATTERN_TEXT}`);
  return id;
}

export function sameToken(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieToken(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return value.join('=');
  }
  return undefined;
}

export function send(
  response: ServerResponse,
  status: number,
  body: string,
  type: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  response.end(body);
}

export function json(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, JSON.stringify(value), 'application/json');
}

export async function readJson(incoming: IncomingMessage): Promise<unknown> {
  if (!(incoming.headers['content-type'] ?? '').startsWith('application/json'))
    throw panel('unsupported', 'content-type must be application/json');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of incoming as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw panel('too_large', 'request body is too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw panel('invalid', 'invalid JSON');
  }
}

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw panel('invalid', z.prettifyError(parsed.error));
  return parsed.data;
}

/** Whether `Host` (and `Origin`, when sent) name this panel's loopback address. */
export function hostAllowed(incoming: IncomingMessage, port: number): boolean {
  const given = incoming.headers.host?.toLowerCase();
  if (given === undefined) return false;
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!allowed.has(given)) return false;
  const origin = incoming.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host.toLowerCase() === given;
  } catch {
    return false;
  }
}

/** `?repository=` must be an absolute path. */
export function absoluteRepository(value: string | null): string {
  if (value === null || !isAbsolute(value)) {
    throw panel('invalid', 'repository must be an absolute path');
  }
  return value;
}

/** Decodes the captured parts of a path. */
export function decodeParts(parts: string[]): string[] {
  try {
    return parts.map((part) => decodeURIComponent(part));
  } catch {
    throw panel('invalid', 'malformed percent-encoding in path');
  }
}
