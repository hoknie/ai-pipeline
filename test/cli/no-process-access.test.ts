import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = join(import.meta.dirname, '..', '..', 'src');
const roots = [join(src, 'presentation', 'cli'), join(src, 'presentation', 'web')];

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

// What a command gets from the call (working directory, environment, streams, exit code) comes
// through `CliIo`; only the entry point reads `process`.
const FORBIDDEN = [
  'process.exit(',
  'process.exitCode',
  'process.stdout',
  'process.stderr',
  'process.stdin',
  'process.cwd(',
  'process.env',
  'console.log(',
];

describe('src/cli', () => {
  it('holds only the entry point', () => {
    expect(readdirSync(join(src, 'cli'))).toEqual(['main.ts']);
  });
});

describe('src/presentation/cli and src/presentation/web', () => {
  const files = roots.flatMap(sources);

  it('finds the sources of the CLI and the panel', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN)('does not use %s', (pattern) => {
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(pattern));
    expect(offenders.map((file) => relative(src, file))).toEqual([]);
  });

  it('keeps no module-level style of the call', () => {
    const offenders = files.filter((file) =>
      /^let activeStyle\b/m.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
