import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

/** Paths where the word is not about the pipelines of aip. */
const OTHER_MEANING = [/^\.github\//, /^\.claude\//, /^openspec\//, /^docs\/development\.md$/];

/**
 * The places that keep the old name on purpose: the old directory, keys, placeholders, options and
 * addresses that are still read, the migration history, and the tests of that compatibility.
 * The list only shrinks.
 */
const COMPATIBILITY = [
  'src/platform/sqlite/migrations.ts',
  'src/feature/runs/services/effects/actions.ts',
  'test/daemon/actions.test.ts',
  'src/feature/swarm-config/repositories/config-files.ts',
  'src/feature/swarm-config/services/assemble.ts',
  'src/feature/swarm-config/services/validate-pipelines.ts',
  'src/feature/swarm-config/types/levels.ts',
  'src/feature/swarm-config/types/settings.ts',
  'src/feature/swarm-edit/repositories/documents.ts',
  'src/feature/runs/machine/texts.ts',
  'src/presentation/cli/commands/queue-edit.ts',
  'src/presentation/cli/local/config-check.ts',
  'web/src/shared/lib/nav/route.ts',
  'docs/configuration/pipelines.md',
  'docs/configuration/delivery.md',
  'test/terminology.test.ts',
  'test/feature/swarm-edit/legacy-names.test.ts',
  'test/feature/swarm-edit/pipeline-import.test.ts',
  'test/daemon/control-outside.test.ts',
  'test/feature/storage.ts',
  'test/platform/sqlite/migrations.test.ts',
  'test/feature/runs/delivery.test.ts',
  'test/cli/cli-output.test.ts',
  'test/cli/cli-daemon.test.ts',
  'test/cli/web.test.ts',
  'test/mcp/host.test.ts',
  'web/test/pipelines.test.tsx',
  'web/test/i18n.test.tsx',
];

function trackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split('\n').filter((file) => file !== '' && existsSync(join(root, file)));
}

function hasWord(text: string): boolean {
  return /workflow/i.test(text);
}

describe('terminology', () => {
  const files = trackedFiles().filter(
    (file) => !OTHER_MEANING.some((pattern) => pattern.test(file)),
  );

  it('names the concept only pipeline, also in file names', () => {
    const offenders = files.filter((file) => hasWord(file));
    expect(offenders).toEqual([]);
  });

  it('keeps the old word out of every file except the compatibility places', () => {
    const offenders = files.flatMap((file) => {
      if (COMPATIBILITY.includes(file)) return [];
      let text: string;
      try {
        text = readFileSync(join(root, file), 'utf8');
      } catch {
        return [];
      }
      return text
        .split('\n')
        .flatMap((line, index) => (hasWord(line) ? [`${file}:${index + 1}`] : []));
    });
    expect(offenders).toEqual([]);
  });

  it('lists only compatibility places that still use the word', () => {
    const unused = COMPATIBILITY.filter((file) => {
      if (file === 'test/terminology.test.ts') return false;
      return !hasWord(readFileSync(join(root, file), 'utf8'));
    });
    expect(unused).toEqual([]);
  });
});
