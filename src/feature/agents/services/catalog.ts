import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import { parse } from 'yaml';

import type { CatalogEntry } from '../types/index.ts';

const DESCRIPTION_LIMIT = 300;
const SOURCE_ORDER = { builtin: 0, project: 1, global: 2 } as const;

export function sortEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort(
    (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.name.localeCompare(b.name),
  );
}

function inside(path: string, directory: string): boolean {
  return (
    path === directory || path.startsWith(directory.endsWith(sep) ? directory : directory + sep)
  );
}

function sourceOf(directory: string, repository: string, home: string): 'project' | 'global' {
  if (inside(directory, repository)) return 'project';
  if (inside(directory, home)) return 'global';
  return 'global';
}

function descriptionOf(file: string): string | undefined {
  try {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(readFileSync(file, 'utf8'));
    if (!match?.[1]) return undefined;
    const value = (parse(match[1]) as { description?: unknown } | null)?.description;
    if (typeof value !== 'string') return undefined;
    const text = value.trim().replace(/\s+/g, ' ');
    if (!text) return undefined;
    return text.length > DESCRIPTION_LIMIT ? text.slice(0, DESCRIPTION_LIMIT) : text;
  } catch {
    return undefined;
  }
}

/** Resolves links; `null` for anything unreadable or missing. */
function resolved(path: string): { path: string; directory: boolean } | null {
  try {
    const real = realpathSync(path);
    return { path: real, directory: statSync(real).isDirectory() };
  } catch {
    return null;
  }
}

function list(directory: string): string[] {
  try {
    return readdirSync(directory).sort();
  } catch {
    return [];
  }
}

/**
 * Skills and commands found in the given runtime directories: `<name>/SKILL.md`, `<name>.md`
 * and `<a>/<b>.md` (named `a:b`). A directory under `repository` gives `project`, under
 * `home` `global`.
 */
export function skillCatalog(
  directories: string[],
  repository: string,
  home: string,
): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  const add = (name: string, source: 'project' | 'global', file: string) => {
    const real = resolved(file);
    if (!real || real.directory) return;
    const key = `${source}\0${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const description = descriptionOf(real.path);
    entries.push({ name, source, file: real.path, ...(description ? { description } : {}) });
  };
  for (const directory of directories) {
    const source = sourceOf(directory, repository, home);
    for (const item of list(directory)) {
      const path = join(directory, item);
      const found = resolved(path);
      if (!found) continue;
      if (!found.directory) {
        if (item.endsWith('.md') && item.length > 3) add(item.slice(0, -3), source, path);
        continue;
      }
      if (resolved(join(path, 'SKILL.md'))) {
        add(item, source, join(path, 'SKILL.md'));
        continue;
      }
      for (const inner of list(path)) {
        if (inner.endsWith('.md') && inner.length > 3) {
          add(`${item}:${inner.slice(0, -3)}`, source, join(path, inner));
        }
      }
    }
  }
  return sortEntries(entries);
}

function serversIn(file: string, source: 'project' | 'global'): CatalogEntry[] {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: unknown };
    const servers = data?.mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
    return Object.keys(servers).map((server) => ({ name: `mcp__${server}`, source, file }));
  } catch {
    return [];
  }
}

/** `mcp__<server>` for the servers of `<repository>/.mcp.json` and `<home>/.claude.json`. */
export function mcpServers(repository: string, home: string): CatalogEntry[] {
  return sortEntries([
    ...serversIn(join(repository, '.mcp.json'), 'project'),
    ...serversIn(join(home, '.claude.json'), 'global'),
  ]);
}
