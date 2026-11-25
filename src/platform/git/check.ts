import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GroupChange } from './delivery.ts';
import { gitFailure, runGit } from './runner.ts';

function lines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

/** Files of the temporary index that git could not merge. */
async function unmerged(repository: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const output = (await runGit(repository, ['ls-files', '-u'], { env })).stdout.trim();
  return [
    ...new Set(
      lines(output)
        .map((line) => line.split('\t')[1] ?? '')
        .filter(Boolean),
    ),
  ].sort();
}

/**
 * The files of `changes` that conflict when applied on top of `base`, checked in a temporary index:
 * the working tree, the index and the branches of the user are never touched. This is how a probe
 * learns whether its result would deliver, without delivering anything.
 */
export async function conflictsOnBase(
  repository: string,
  base: string,
  changes: GroupChange[],
): Promise<string[]> {
  const directory = mkdtempSync(join(tmpdir(), 'aip-probe-'));
  const environment = { GIT_INDEX_FILE: join(directory, 'probe.index') };
  try {
    await runGit(repository, ['read-tree', base], { env: environment });
    const conflicts = new Set<string>();
    for (const [index, change] of changes.entries()) {
      const patch = (await runGit(repository, ['diff', '--binary', '-M', change.from, change.to]))
        .stdout;
      if (patch.trim() === '') continue;
      const path = join(directory, `${index}.patch`);
      writeFileSync(path, patch);
      const result = await runGit(repository, ['apply', '--3way', '--cached', path], {
        allowFailure: true,
        env: environment,
      });
      if (result.code === 0) continue;
      const files = await unmerged(repository, environment);
      if (files.length === 0) throw gitFailure(`patch does not apply: ${result.stderr.trim()}`);
      for (const file of files) conflicts.add(file);
      break;
    }
    return [...conflicts].sort();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
