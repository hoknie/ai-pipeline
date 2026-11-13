import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { databasePath } from '../../src/platform/paths/index.ts';

import { CODE_ONLY_CONFIG, harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const CONFIG = `${CODE_ONLY_CONFIG}  mcp_servers:
    github:
      command: gh-mcp
      args: ["--home=$\${HOME}"]
      env: { TOKEN: "\${AIP_TEST_TOKEN}" }
      all_specialists: true
`;

async function start(environment: NodeJS.ProcessEnv): Promise<Harness> {
  current = await harness(CONFIG, { AIP_TEST_TOKEN: undefined, ...environment });
  mkdirSync(current.fakeState, { recursive: true });
  current.environment.AIP_FAKE_ARGV_LOG = join(current.fakeState, 'argv.jsonl');
  return current;
}

async function run(h: Harness): Promise<string> {
  return (await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'сделать' })).runId;
}

describe('environment references of MCP servers', () => {
  it('put the value into the file of the attempt and keep the reference in the snapshot', async () => {
    const h = await start({ AIP_TEST_TOKEN: 'secret-value' });
    const runId = await run(h);
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups[0]?.reason).toBeNull();
    expect(final.groups[0]?.status).toBe('merged');
    const call = readFileSync(join(h.fakeState, 'argv.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { argv: string[] })
      .find((item) => item.argv.includes('--session-id'));
    const file = call!.argv[call!.argv.indexOf('--mcp-config') + 1]!;
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const config = JSON.parse(readFileSync(file, 'utf8')) as {
      mcpServers: Record<string, { env: Record<string, string>; args: string[] }>;
    };
    expect(config.mcpServers.github?.env.TOKEN).toBe('secret-value');
    expect(config.mcpServers.github?.args).toEqual(['--home=${HOME}']);
    const database = new DatabaseSync(databasePath(h.state));
    const row = database.prepare('SELECT config_json FROM runs WHERE id = ?').get(runId) as {
      config_json: string;
    };
    database.close();
    expect(row.config_json).toContain('${AIP_TEST_TOKEN}');
    expect(row.config_json).not.toContain('secret-value');
  });

  it('fail the attempt with a spawn error when the variable is not set', async () => {
    const h = await start({});
    const final = await h.waitFor(await run(h), (view) => view.finished);
    expect(final.groups[0]?.status).toBe('failed');
    expect(final.groups[0]?.reason).toContain(
      'MCP server github: environment variable AIP_TEST_TOKEN is not set',
    );
  });
});
