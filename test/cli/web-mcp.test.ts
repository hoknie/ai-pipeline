import { existsSync, readFileSync } from 'node:fs';
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

const JSON_TYPE = { 'content-type': 'application/json' };

async function setup(): Promise<{ web: WebServer; base: string; globalFile: string }> {
  h = await harness(MANUAL_CONFIG);
  web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
  return {
    web,
    base: `http://127.0.0.1:${web.port}`,
    globalFile: join(h.environment.XDG_CONFIG_HOME!, 'aip', 'settings.yaml'),
  };
}

const send = (web: WebServer, url: string, method: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { 'x-aip-token': web.token ?? '', ...JSON_TYPE },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const server = (env: Record<string, string | null> = {}) => ({
  command: '/bin/graph',
  args: ['--x'],
  env,
  allSpecialists: true,
});

describe('routes of the MCP server catalog', () => {
  it('write a server, show it without secrets, keep a secret on edit and delete it', async () => {
    const { web, base, globalFile } = await setup();
    const url = `${base}/api/config/mcp-servers/graph`;
    const created = await send(web, url, 'PUT', {
      value: server({ TOKEN: 'topsecret' }),
      revision: null,
      level: 'global',
    });
    expect(created.status).toBe(200);
    expect(JSON.stringify(await created.clone().json())).not.toContain('topsecret');
    const read = async () =>
      (await (await send(web, `${base}/api/config`, 'GET')).json()) as {
        mcpServers: { name: string; envNames: string[] }[];
        settingsFiles: { global: { revision: string } };
      };
    const view = await read();
    expect(JSON.stringify(view)).not.toContain('topsecret');
    expect(view.mcpServers).toEqual([
      expect.objectContaining({ name: 'graph', envNames: ['TOKEN'], allSpecialists: true }),
    ]);
    const edited = await send(web, url, 'PUT', {
      value: { ...server({ TOKEN: null }), args: ['--y'] },
      revision: view.settingsFiles.global.revision,
      level: 'global',
    });
    expect(edited.status).toBe(200);
    expect(readFileSync(globalFile, 'utf8')).toContain('topsecret');
    expect(readFileSync(globalFile, 'utf8')).toContain('--y');
    const revision = (await read()).settingsFiles.global.revision;
    const removed = await send(web, `${url}?revision=${revision}&level=global`, 'DELETE');
    expect(removed.status).toBe(200);
    expect((await read()).mcpServers).toEqual([]);
  });

  it('refuse a name that is not a name and a wrong command without writing', async () => {
    const { web, base, globalFile } = await setup();
    const body = { value: server(), revision: null, level: 'global' };
    expect((await send(web, `${base}/api/config/mcp-servers/..%2Fx`, 'PUT', body)).status).toBe(
      400,
    );
    expect((await send(web, `${base}/api/config/mcp-servers/aip`, 'PUT', body)).status).toBe(400);
    const wrong = await send(web, `${base}/api/config/mcp-servers/graph`, 'PUT', {
      ...body,
      value: { ...server(), command: 'bin/graph' },
    });
    expect(wrong.status).toBe(422);
    expect(JSON.stringify(await wrong.json())).toContain('swarm.mcp_servers.graph.command');
    expect(existsSync(globalFile)).toBe(false);
  });

  it('answer 409 for a stale revision', async () => {
    const { web, base } = await setup();
    const url = `${base}/api/config/mcp-servers/graph`;
    await send(web, url, 'PUT', { value: server(), revision: null, level: 'global' });
    const stale = await send(web, url, 'PUT', { value: server(), revision: null, level: 'global' });
    expect(stale.status).toBe(409);
  });
});
