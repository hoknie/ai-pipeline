import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeConfigDirectory } from './config.ts';

/** Template repositories of this test file (modules are isolated per file), by config and files. */
const templates = new Map<string, string>();

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/**
 * Creates `repo` as a copy of a repository with one commit holding the config `config` and
 * `files`. The repository is built once per test file and copied afterwards, which is much
 * cheaper than `git init`, `config`, `add` and `commit` for every test.
 */
export function copyTemplateRepo(
  repo: string,
  config: string,
  files: Record<string, string> = {},
): void {
  const key = JSON.stringify([config, files]);
  let template = templates.get(key);
  if (template === undefined) {
    template = join(realpathSync(mkdtempSync(join(tmpdir(), 'aip-template-'))), 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', template]);
    git(template, 'config', 'user.name', 'Test');
    git(template, 'config', 'user.email', 'test@example.com');
    // A commit otherwise leaves a detached `git maintenance` behind: its lock file in .git/objects
    // can vanish in the middle of the copy, and the copy fails with ENOENT.
    git(template, 'config', 'maintenance.auto', 'false');
    for (const [name, text] of Object.entries(files)) writeFileSync(join(template, name), text);
    writeConfigDirectory(template, config);
    git(template, 'add', '-A');
    git(template, 'commit', '-q', '-m', 'initial');
    templates.set(key, template);
  }
  cpSync(template, repo, { recursive: true });
}
