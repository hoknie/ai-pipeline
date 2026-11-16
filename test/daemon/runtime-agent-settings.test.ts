import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CODE_ONLY_CONFIG } from './harness.ts';
import { calls, run, start } from './control-harness.ts';

it('passes isolated OpenCode MCP configuration to the fake agent', async () => {
  const config = CODE_ONLY_CONFIG.replace(
    '  max: 3',
    '  max: 3\n  opencode: { mcp: isolated }',
  ).replace('name: Coder', 'name: Coder, runtime: opencode');
  const h = await start(config);
  const dir = join(h.environment.XDG_CONFIG_HOME!, 'opencode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), '{"mcp":{"jira":{}}}');
  h.script({ code: [{}] });
  const id = await run(h);
  await h.waitFor(id, (view) => view.finished);
  expect(JSON.parse(calls(h)[0]!.configContent!)).toEqual({ mcp: { jira: { enabled: false } } });
});

it('passes agy overrides below the generated permission settings', async () => {
  const config = CODE_ONLY_CONFIG.replace(
    '  max: 3',
    '  max: 3\n  agy: { overrides: { theme: dark, toolPermission: always-proceed } }',
  ).replace('name: Coder', 'name: Coder, runtime: agy');
  const h = await start(config);
  h.script({ code: [{}] });
  const id = await run(h);
  await h.waitFor(id, (view) => view.finished);
  expect(calls(h)[0]!.settings).toMatchObject({ theme: 'dark', toolPermission: 'request-review' });
});
