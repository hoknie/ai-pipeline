import { execFile, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const main = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts');
const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-init-')));

function aip(args: string[], cwd: string, name: string) {
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: join(base, name, 'config'),
    XDG_STATE_HOME: join(base, name, 'state'),
    AIP_CLAUDE_BIN: join(import.meta.dirname, '..', 'fakes', 'claude'),
  };
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [main, ...args],
      { cwd, env, timeout: 30_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

function repository(name: string): string {
  const directory = join(base, name, 'repo');
  mkdirSync(join(directory, 'src', 'deep'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: directory });
  return directory;
}

describe('aip init', () => {
  it('writes the starter configuration to the repository root from a subdirectory', async () => {
    const repo = repository('sub');
    const result = await aip(['init'], join(repo, 'src', 'deep'), 'sub');
    expect(result.code).toBe(0);
    for (const file of [
      'settings.yaml',
      'specialists/coder.yaml',
      'specialists/reviewer.yaml',
      'workflows/feature.yaml',
    ]) {
      expect(existsSync(join(repo, 'aip', file)), file).toBe(true);
    }
    expect(result.stdout).toContain('aip config check');
    const check = await aip(['config', 'check'], repo, 'sub');
    expect(check.code, check.stderr).toBe(0);
    expect(check.stdout).toContain('feature');
  });

  it('keeps existing files and lists them', async () => {
    const repo = repository('keep');
    mkdirSync(join(repo, 'aip', 'specialists'), { recursive: true });
    writeFileSync(join(repo, 'aip', 'specialists', 'coder.yaml'), 'name: Mine\n');
    const result = await aip(['init'], repo, 'keep');
    expect(result.code).toBe(0);
    expect(readFileSync(join(repo, 'aip', 'specialists', 'coder.yaml'), 'utf8')).toBe(
      'name: Mine\n',
    );
    expect(result.stdout).toContain('coder.yaml');
    expect(result.stdout).toContain('already exists');
    expect(existsSync(join(repo, 'aip', 'workflows', 'feature.yaml'))).toBe(true);
  });

  it('fails outside a repository and creates nothing', async () => {
    const outside = join(base, 'outside');
    mkdirSync(outside, { recursive: true });
    const result = await aip(['init'], outside, 'outside');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--shared');
    expect(existsSync(join(outside, 'aip'))).toBe(false);
  });

  it('writes the shared configuration with --shared and leaves the repository alone', async () => {
    const repo = repository('shared');
    const result = await aip(['init', '--shared'], repo, 'shared');
    expect(result.code).toBe(0);
    expect(existsSync(join(base, 'shared', 'config', 'aip', 'settings.yaml'))).toBe(true);
    expect(existsSync(join(repo, 'aip'))).toBe(false);
  });
});
