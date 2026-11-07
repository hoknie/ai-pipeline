import { isAbsolute } from 'node:path';
import type { IncomingMessage } from 'node:http';

import { panel } from './errors.ts';
import { readJson } from './http.ts';
import type { WebOptions } from './options.ts';

function transcriptQuery(search: URLSearchParams): { seq?: number; after?: number } {
  const query: { seq?: number; after?: number } = {};
  for (const [key, low] of [
    ['seq', 1],
    ['after', 0],
  ] as const) {
    const value = search.get(key);
    if (value === null) continue;
    const number = Number(value);
    if (!Number.isInteger(number) || number < low)
      throw panel('invalid', `${key} must be an integer from ${low}`);
    query[key] = number;
  }
  return query;
}

function deleteQuery(search: URLSearchParams): object {
  const revision = search.get('revision');
  const level = search.get('level');
  if (level !== null && level !== 'project' && level !== 'global') {
    throw panel('invalid', 'level must be project or global');
  }
  return { ...(revision ? { revision } : {}), ...(level ? { level } : {}) };
}

function boundedInteger(search: URLSearchParams, name: string, fallback: number, max: number) {
  const value = Number(search.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw panel('invalid', `${name} must be an integer from 1 to ${max}`);
  return value;
}

/** The body a handler gets: the JSON body of a write, the validated query of a read. */
export async function requestBody(incoming: IncomingMessage, url: URL): Promise<unknown> {
  const verb = incoming.method ?? 'GET';
  const { pathname, searchParams } = url;
  if (verb === 'POST' || verb === 'PUT') return readJson(incoming);
  if (verb === 'DELETE') return deleteQuery(searchParams);
  if (/\/groups\/[^/]+$/.test(pathname))
    return { tail: boundedInteger(searchParams, 'tail', 40, 500) };
  if (pathname === '/api/finished-runs') {
    const limit = boundedInteger(searchParams, 'limit', 15, 100);
    const before = searchParams.get('before');
    return { limit, ...(before ? { before } : {}) };
  }
  if (pathname.endsWith('/transcript')) return transcriptQuery(searchParams);
  if (pathname.endsWith('/diff')) {
    const path = searchParams.get('path');
    if (path === null || path === '') throw panel('invalid', 'path is required');
    return { path };
  }
  return {};
}

/** Runs and processes belong to the daemon, not to a repository: they work without one. */
function repositoryFree(pathname: string, search: URLSearchParams): boolean {
  // A returned run belongs to its own repository unless the request names one.
  const own =
    (pathname === '/api/queue/return' || pathname === '/api/queue/dismiss') &&
    !search.get('repository');
  return (
    pathname.startsWith('/api/runs') ||
    pathname === '/api/finished-runs' ||
    pathname.startsWith('/api/processes') ||
    pathname.startsWith('/api/specialist-tags') ||
    pathname === '/api/observers' ||
    own
  );
}

/** The repository of a request: `?repository=` (absolute path) or the one of the panel. */
export async function requestRepository(
  url: URL,
  options: Pick<WebOptions, 'repository' | 'defaultRepository'>,
): Promise<string> {
  if (repositoryFree(url.pathname, url.searchParams)) return '';
  const chosen = url.searchParams.get('repository');
  if (chosen === null || chosen === '') {
    if (options.repository !== undefined) return options.repository;
    const found = (await options.defaultRepository?.()) ?? null;
    if (found === null) throw panel('conflict', 'no repository yet: add one in the panel');
    return found;
  }
  if (!isAbsolute(chosen)) throw panel('invalid', 'repository must be an absolute path');
  return chosen;
}
