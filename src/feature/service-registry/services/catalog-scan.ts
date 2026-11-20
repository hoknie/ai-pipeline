import { normalizeRemote } from '../../repos/types/index.ts';
import type { Connection } from '../../integrations/types/index.ts';
import { LIST_PAGES_LIMIT, PROJECT_LIST_PAGE_SIZE } from '../types/index.ts';

import type { RegistryCalls } from './calls.ts';

/** The longest one call of the matching waits for the registry. */
export const LINK_CALL_TIMEOUT_MS = 15_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The paths of the projects of the registry whose `repo_url` is `wanted` in the normal form, read
 * page by page through `list_projects` (at most `LIST_PAGES_LIMIT` pages). `truncated`: the
 * catalog was not read to its end. A failure of the registry is thrown as it is.
 */
export async function scanCatalog(
  calls: RegistryCalls,
  connection: Connection,
  token: string,
  wanted: string,
): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = [];
  let cursor: string | null = null;
  let offset = 0;
  let lastFirst: unknown;
  for (let page = 0; ; page += 1) {
    if (page >= LIST_PAGES_LIMIT) return { paths, truncated: true };
    const answer = await calls.call(
      connection,
      token,
      'list_projects',
      {
        limit: PROJECT_LIST_PAGE_SIZE,
        ...(cursor !== null ? { cursor } : offset > 0 ? { offset } : {}),
      },
      LINK_CALL_TIMEOUT_MS,
    );
    const items =
      isObject(answer) && Array.isArray(answer.items) ? (answer.items as unknown[]) : [];
    for (const item of items) {
      if (!isObject(item) || typeof item.path !== 'string') continue;
      const url = typeof item.repo_url === 'string' ? normalizeRemote(item.repo_url) : null;
      if (url === wanted) paths.push(item.path);
    }
    const next = isObject(answer) ? (answer.next_cursor ?? answer.nextCursor) : undefined;
    const first = items.length > 0 && isObject(items[0]) ? items[0].path : undefined;
    if (typeof next === 'string' && next !== '') {
      cursor = next;
    } else if (items.length > 0 && !(first !== undefined && first === lastFirst)) {
      // a registry that gives no cursor is read by offset until an empty page
      cursor = null;
      offset += items.length;
    } else {
      return { paths, truncated: false };
    }
    lastFirst = first;
  }
}
