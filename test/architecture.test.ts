import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', 'src');

const allowedLayers: Record<string, string[]> = {
  config: [],
  core: ['config'],
  store: ['config', 'core'],
  git: [],
  runtime: ['config', 'core', 'protocol'],
  protocol: ['config', 'core'],
  daemon: ['config', 'core', 'store', 'git', 'runtime', 'protocol'],
  mcp: ['config', 'core', 'protocol'],
  cli: ['config', 'core', 'store', 'git', 'runtime', 'protocol', 'daemon', 'mcp'],
};

const pureLayers = new Set(['core']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function imports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const pattern =
    /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...text.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? '');
}

export function violations(sourceRoot: string): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(sourceRoot)) {
    const path = relative(sourceRoot, file);
    const layer = path.split('/')[0] ?? '';
    const allowed = allowedLayers[layer];
    if (!allowed) {
      found.push(`${path}: unknown layer \`${layer}\``);
      continue;
    }
    for (const specifier of imports(file)) {
      if (specifier.startsWith('.')) {
        const target = relative(sourceRoot, join(file, '..', specifier)).split('/')[0] ?? '';
        if (target !== layer && !allowed.includes(target)) {
          found.push(`${path}: layer \`${layer}\` must not import \`${target}\``);
        }
      } else if (pureLayers.has(layer)) {
        found.push(`${path}: layer \`${layer}\` must not import \`${specifier}\``);
      }
    }
  }
  return found;
}

describe('architecture', () => {
  it('keeps every import inside the allowed layers and core free of I/O', () => {
    expect(violations(root)).toEqual([]);
  });
});
