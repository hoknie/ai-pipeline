import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const cli = join(import.meta.dirname, '..', '..', 'src', 'cli');

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

describe('src/cli outside main.ts', () => {
  const files = sources(cli).filter((file) => relative(cli, file) !== 'main.ts');

  it('finds the sources of the CLI', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN)('does not use %s', (pattern) => {
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(pattern));
    expect(offenders.map((file) => relative(cli, file))).toEqual([]);
  });

  it('keeps no module-level style of the call', () => {
    const offenders = files.filter((file) =>
      /^let activeStyle\b/m.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
