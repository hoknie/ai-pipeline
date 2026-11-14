import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ATTACHMENT_MAX_BYTES,
  attachmentNameProblem,
} from '../../feature/attachments/types/index.ts';
import { panel } from './errors.ts';
import type { RawRoute, RouteKit } from './routes/types.ts';

/** Uploads nobody used within a day are deleted. */
export const UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How often the old uploads are looked for. */
export const UPLOAD_SWEEP_MS = 60 * 60 * 1000;

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The body of a request up to the limit; a bigger one is read to its end and refused. */
async function rawBody(incoming: AsyncIterable<Buffer>, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw panel('too_large', `the file is larger than ${limit} bytes`);
  return Buffer.concat(chunks);
}

function fileNameOf(header: string | string[] | undefined): string {
  if (typeof header !== 'string' || header === '')
    throw panel('invalid', 'X-File-Name is required');
  let name: string;
  try {
    name = decodeURIComponent(header);
  } catch {
    throw panel('invalid', 'X-File-Name is not percent-encoded');
  }
  const problem = attachmentNameProblem(name);
  if (problem !== null) throw panel('invalid', problem);
  return name;
}

/** `POST /api/uploads`: a file of an attachment, kept until the task that uses it is added. */
export function uploadRoute(kit: RouteKit): RawRoute {
  return {
    pattern: /^\/api\/uploads$/,
    async handle({ incoming, response, verb }) {
      if (verb !== 'POST') throw panel('method_not_allowed', 'method not allowed');
      const fileName = fileNameOf(incoming.headers['x-file-name']);
      const bytes = await rawBody(incoming as AsyncIterable<Buffer>, ATTACHMENT_MAX_BYTES);
      const upload = randomUUID();
      const directory = join(kit.uploads, upload);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(join(directory, fileName), bytes, { mode: 0o600 });
      const body = JSON.stringify({ upload, fileName, size: bytes.length });
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(body);
    },
  };
}

/** The files of the uploads a task body names, as paths for the daemon; unknown ids are refused. */
export function uploadSources(kit: RouteKit, ids: unknown): { path: string }[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw panel('invalid', 'uploads must be a list of upload ids');
  }
  return (ids as string[]).map((id) => {
    if (!UPLOAD_ID.test(id)) throw panel('invalid', `unknown upload \`${id}\``);
    const directory = join(kit.uploads, id);
    let files: string[];
    try {
      files = readdirSync(directory);
    } catch {
      throw panel('invalid', `unknown upload \`${id}\``);
    }
    const [file] = files;
    if (files.length !== 1 || file === undefined)
      throw panel('invalid', `unknown upload \`${id}\``);
    return { path: join(directory, file) };
  });
}

/** Deletes the used uploads. */
export function dropUploads(kit: RouteKit, ids: unknown): void {
  if (!Array.isArray(ids)) return;
  for (const id of ids) {
    if (typeof id === 'string' && UPLOAD_ID.test(id)) {
      rmSync(join(kit.uploads, id), { recursive: true, force: true });
    }
  }
}

/** Deletes the uploads older than a day. */
export function sweepUploads(directory: string, now: number): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry);
    try {
      if (now - statSync(path).mtimeMs > UPLOAD_MAX_AGE_MS) {
        rmSync(path, { recursive: true, force: true });
      }
    } catch {
      // gone already
    }
  }
}
