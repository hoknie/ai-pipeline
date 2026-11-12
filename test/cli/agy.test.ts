import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_ONLY_CONFIG } from '../daemon/harness.ts';
import { aip, sandbox } from './sandbox.ts';

describe('agy config check', () => {
  const config = CODE_ONLY_CONFIG.replace(
    'coder: { name: Кодировщик }',
    'coder: { name: C, runtime: agy }',
  );
  it('uses the agy override and reports its version', async () => {
    const box = sandbox(config);
    const checked = await aip(box, 'config', 'check');
    expect(checked.code).toBe(0);
    expect(checked.stdout).toContain(`agy: fake agy 0.0.0 (${box.env.AIP_AGY_BIN})`);
  });

  it.each([true, false])('checks an absolute configured command (exists: %s)', async (exists) => {
    const box = sandbox(config);
    const directory = join(box.env.XDG_CONFIG_HOME!, 'aip');
    mkdirSync(directory, { recursive: true });
    const command = exists ? box.env.AIP_AGY_BIN! : '/missing/agy';
    writeFileSync(
      join(directory, 'settings.yaml'),
      `runtimes:\n  agy:\n    enabled: true\n    command: ${command}\n`,
    );
    box.env.AIP_AGY_BIN = '';
    const checked = await aip(box, 'config', 'check');
    expect(checked.code).toBe(0);
    expect(checked.stdout).toContain(
      exists ? `fake agy 0.0.0 (${command})` : 'agy: not found in PATH',
    );
  });
});
