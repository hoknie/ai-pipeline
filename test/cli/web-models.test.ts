import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';
import { MANUAL_CONFIG, harness, type Harness } from '../daemon/harness.ts';

let h: Harness | null = null;
let web: WebServer | null = null;

afterEach(async () => {
  await web?.close();
  await h?.close();
  web = null;
  h = null;
});

interface Models {
  repository: string;
  runtimes: Record<
    'claude' | 'opencode' | 'agy',
    { models: { id: string; group: string }[]; error: string | null }
  >;
}

describe('GET /api/config/models', () => {
  async function setup() {
    h = await harness(MANUAL_CONFIG, { HOME: mkdtempSync(join(tmpdir(), 'aip-models-home-')) });
    const log = join(h.fakeState, 'argv.jsonl');
    mkdirSync(h.fakeState, { recursive: true });
    h.environment.AIP_FAKE_ARGV_LOG = log;
    h.environment.AIP_FAKE_MODELS = 'openai/gpt-5,openrouter/anthropic/claude-opus-5-5';
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    const headers = { 'x-aip-token': web.token ?? '' };
    const read = async (query = '') =>
      (await (await fetch(`${base}/api/config/models${query}`, { headers })).json()) as Models;
    const listings = () => {
      try {
        return readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .filter((line) => line.includes('"models"')).length;
      } catch {
        return 0;
      }
    };
    return { base, read, listings };
  }

  it('groups opencode models by provider, caches them and refreshes on demand', async () => {
    const { read, listings } = await setup();
    const first = await read();
    expect(first.repository).toBe(h!.repo);
    expect(first.runtimes.opencode.error).toBeNull();
    expect(first.runtimes.opencode.models).toEqual([
      { id: 'openai/gpt-5', name: 'gpt-5', group: 'openai' },
      {
        id: 'openrouter/anthropic/claude-opus-5-5',
        name: 'anthropic/claude-opus-5-5',
        group: 'openrouter',
      },
    ]);
    expect(first.runtimes.claude.models[0]?.group).toBe('aliases');
    expect(first.runtimes.agy).toEqual({ models: [], error: null });
    expect(listings()).toBe(1);
    await read();
    expect(listings()).toBe(1);
    h!.environment.AIP_FAKE_MODELS = 'newprovider/model-x';
    expect((await read()).runtimes.opencode.models.map((m) => m.id)).toEqual([
      'openai/gpt-5',
      'openrouter/anthropic/claude-opus-5-5',
    ]);
    const refreshed = await read('?refresh=1');
    expect(refreshed.runtimes.opencode.models.map((m) => m.id)).toEqual(['newprovider/model-x']);
    expect(listings()).toBe(2);
  });

  it('answers 200 with the error when opencode fails and does not cache it', async () => {
    const { read, listings } = await setup();
    h!.environment.AIP_FAKE_MODELS_FAIL = '2';
    const failed = await read();
    expect(failed.runtimes.opencode.models).toEqual([]);
    expect(failed.runtimes.opencode.error).toContain('cannot list models');
    expect(failed.runtimes.claude.models.length).toBeGreaterThan(0);
    delete h!.environment.AIP_FAKE_MODELS_FAIL;
    expect((await read()).runtimes.opencode.models).toHaveLength(2);
    expect(listings()).toBe(2);
  });

  it('is behind the token', async () => {
    const { base } = await setup();
    expect((await fetch(`${base}/api/config/models`)).status).toBe(401);
  });
});
