import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/aip-web.sh');
const fake = resolve('test/fakes/web-server.ts');
const hasLsof = spawnSync('lsof', ['-v']).error === undefined;
const portIt = it.skipIf(!hasLsof);

let base = '';
let state = '';
let manual: ChildProcess | null = null;
let foreign: Server | null = null;
let command = '';
let port = 0;

async function setup(): Promise<void> {
  port = await freePort();
  base = mkdtempSync(join(tmpdir(), 'aip-web-script-'));
  state = join(base, 'state');
  // The script recognises `aip web` by " web" in the command line.
  mkdirSync(join(base, 'bin'));
  copyFileSync(fake, join(base, 'bin', 'main.ts'));
  command = `${process.execPath} ${join(base, 'bin', 'main.ts')} web`;
}

/**
 * Runs the script without blocking the event loop: a blocked loop cannot reap an `aip web` that
 * this process started and the script stopped, and the script would wait for the zombie.
 */
function run(
  args: string[],
  extra: Record<string, string> = {},
): Promise<{ code: number | null; out: string }> {
  const child = spawn('bash', [script, ...args], {
    cwd: base,
    env: {
      ...process.env,
      AIP_WEB_PORT: String(port),
      AIP_WEB_STATE: state,
      AIP_WEB_COMMAND: command,
      AIP_WEB_STOP_TIMEOUT: '5',
      XDG_STATE_HOME: join(base, 'xdg-state'),
      ...extra,
    },
  });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
  return new Promise((done) => child.on('close', (code) => done({ code, out })));
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const pidOf = (): number => Number(readFileSync(join(state, 'pid'), 'utf8'));

async function waitDead(pid: number): Promise<void> {
  for (let i = 0; i < 100 && alive(pid); i += 1) await new Promise((r) => setTimeout(r, 50));
}

afterEach(async () => {
  manual?.kill('SIGKILL');
  if (base) await run(['stop', String(port)]);
  manual = null;
  await new Promise<void>((done) => (foreign ? foreign.close(() => done()) : done()));
  foreign = null;
});

describe('scripts/aip-web.sh', () => {
  portIt(
    'restart prints the link, keeps it on a second restart and stops the old process',
    async () => {
      await setup();
      const first = await run(['restart', String(port)]);
      expect(first.code).toBe(0);
      const link = /^aip web: (http\S+)$/m.exec(first.out)?.[1] ?? '';
      expect(link).toContain(`:${port}/?token=`);
      const oldPid = pidOf();
      expect((await fetch(link)).status).toBe(200);
      expect(statSync(join(state, 'token')).mode & 0o777).toBe(0o600);

      const second = await run(['restart', String(port)]);
      expect(second.code).toBe(0);
      expect(second.out).toContain(link);
      expect(pidOf()).not.toBe(oldPid);
      expect(alive(oldPid)).toBe(false);
      expect((await fetch(link)).status).toBe(200);

      const status = await run(['status']);
      expect(status.out).toContain(link);
      expect(status.out).toContain(`pid ${pidOf()}`);
    },
  );

  portIt('stop kills the server and is idempotent', async () => {
    await setup();
    expect((await run(['restart', String(port)])).code).toBe(0);
    const pid = pidOf();
    const stopped = await run(['stop']);
    expect(stopped.code).toBe(0);
    await waitDead(pid);
    expect(alive(pid)).toBe(false);
    const again = await run(['stop']);
    expect(again.code).toBe(0);
    expect(again.out).toContain('aip web is not running');
    expect((await run(['status'])).out).toContain('aip web is not running');
  });

  portIt('restart returns the link of a panel served by the daemon', async () => {
    await setup();
    const result = await run(['restart', String(port)], { FAKE_WEB_DAEMON: '1' });
    expect(result.code).toBe(0);
    expect(result.out).toContain(`aip web: http://127.0.0.1:${port}/?token=daemontoken1234567`);
    expect(existsSync(join(state, 'pid'))).toBe(false);
  });

  it('status shows the link from the daemon state file when there is no own process', async () => {
    await setup();
    mkdirSync(join(base, 'xdg-state', 'aip'), { recursive: true });
    writeFileSync(
      join(base, 'xdg-state', 'aip', 'web.json'),
      JSON.stringify({
        pid: process.pid,
        host: '127.0.0.1',
        port,
        auth: 'none',
        token: null,
        url: `http://127.0.0.1:${port}/`,
      }),
    );
    const result = await run(['status']);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`aip web: http://127.0.0.1:${port}/`);
    expect(result.out).toContain('served by the aip daemon');
  });

  it('removes a stale pid file without an error', async () => {
    await setup();
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, 'pid'), '99999999\n');
    const result = await run(['stop', String(5)]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('aip web is not running');
    expect(existsSync(join(state, 'pid'))).toBe(false);
  });

  async function startManual(): Promise<number> {
    manual = spawn(
      process.execPath,
      [join(base, 'bin', 'main.ts'), 'web', '--port', String(port)],
      {
        env: { ...process.env, AIP_WEB_TOKEN: 'abcdefghijklmnop1234' },
        stdio: 'ignore',
      },
    );
    for (let i = 0; i < 100; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${port}/`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    return manual.pid as number;
  }

  portIt('restart stops an aip web started by hand on the port', async () => {
    await setup();
    const manualPid = await startManual();
    const result = await run(['restart', String(port)]);
    expect(result.code).toBe(0);
    await waitDead(manualPid);
    expect(alive(manualPid)).toBe(false);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
  });

  portIt('stop without a port and a port file leaves aip web on AIP_WEB_PORT alone', async () => {
    await setup();
    const manualPid = await startManual();
    const result = await run(['stop']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('aip web is not running');
    expect(alive(manualPid)).toBe(true);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
  });

  portIt('stop with an explicit port stops aip web started by hand', async () => {
    await setup();
    const manualPid = await startManual();
    const result = await run(['stop', String(port)]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('aip web stopped');
    await waitDead(manualPid);
    expect(alive(manualPid)).toBe(false);
  });

  portIt('restart refuses to touch a foreign process on the port', async () => {
    await setup();
    foreign = createServer((_request, response) => response.end('x'));
    await new Promise<void>((done) => foreign!.listen(0, '127.0.0.1', done));
    const foreignPort = (foreign.address() as AddressInfo).port;
    const result = await run(['restart', String(foreignPort)]);
    expect(result.code).toBe(1);
    expect(result.out).toContain(`pid ${process.pid}`);
    expect(alive(process.pid)).toBe(true);
    expect((await fetch(`http://127.0.0.1:${foreignPort}/`)).status).toBe(200);
  });

  it('shows the log tail and fails when the server dies at start', async () => {
    await setup();
    const result = await run(['restart', String(port)], { FAKE_WEB_FAIL: '1' });
    expect(result.code).toBe(1);
    expect(result.out).toContain('EADDRINUSE');
    expect(existsSync(join(state, 'pid'))).toBe(false);
    expect((await run(['status'])).out).toContain('aip web is not running');
  });

  it('kills a server that does not print its link in time', async () => {
    await setup();
    const result = await run(['restart', String(port)], {
      FAKE_WEB_SILENT: '1',
      AIP_WEB_TIMEOUT: '1',
    });
    expect(result.code).toBe(1);
    expect(result.out).toContain('did not print its link');
    expect(existsSync(join(state, 'pid'))).toBe(false);
  });
});
