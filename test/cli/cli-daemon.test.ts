import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { request } from '../../src/protocol/index.ts';
import { aip, main, runOf, sandbox, waitUntil, type Sandbox } from './sandbox.ts';

describe('cli', () => {
  it('starts, reports and stops the daemon with aip daemon', async () => {
    const box = sandbox();
    const first = await aip(box, 'daemon', 'start');
    expect(first.code).toBe(0);
    const pid = /started \(pid (\d+)\)/.exec(first.stdout)?.[1];
    expect(pid).toBeDefined();
    const status = await aip(box, 'daemon', 'status');
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(`aip daemon: running (pid ${pid})`);
    expect(status.stdout).toContain('busy: no');
    const again = await aip(box, 'daemon', 'start');
    expect(again).toMatchObject({ code: 0, stdout: `aip daemon: already running (pid ${pid})\n` });
    const json = JSON.parse((await aip(box, 'daemon', 'status', '--json')).stdout) as {
      running: boolean;
      pid: number;
    };
    expect(json).toMatchObject({ running: true, pid: Number(pid) });
    const stopped = await aip(box, 'daemon', 'stop');
    expect(stopped).toMatchObject({ code: 0, stdout: `aip daemon: stopped (pid ${pid})\n` });
    expect(existsSync(box.socket)).toBe(false);
    expect(existsSync(join(box.state, 'aip.pid'))).toBe(false);
  });

  it('reports a missing daemon without starting it', async () => {
    const box = sandbox();
    const status = await aip(box, 'daemon', 'status', '--json');
    expect(status.code).toBe(3);
    expect(JSON.parse(status.stdout)).toMatchObject({ running: false, pid: null });
    expect(await aip(box, 'daemon', 'status')).toMatchObject({
      code: 3,
      stdout: 'aip daemon: not running\n',
    });
    expect(await aip(box, 'daemon', 'stop')).toMatchObject({
      code: 0,
      stdout: 'aip daemon: not running\n',
    });
    expect(existsSync(box.socket)).toBe(false);
  });

  it('restarts the daemon with a new pid, or just starts it', async () => {
    const box = sandbox();
    const fresh = await aip(box, 'daemon', 'restart');
    expect(fresh.code).toBe(0);
    const pid = /started \(pid (\d+)\)/.exec(fresh.stdout)?.[1];
    expect(pid).toBeDefined();
    const restarted = await aip(box, 'daemon', 'restart');
    expect(restarted.code).toBe(0);
    const next = /restarted \(pid (\d+)\)/.exec(restarted.stdout)?.[1];
    expect(next).toBeDefined();
    expect(next).not.toBe(pid);
    expect((await aip(box, 'daemon', 'status')).stdout).toContain(`(pid ${next})`);
  });

  it('refuses to stop a busy daemon unless --force, and interrupts the step then', async () => {
    const box = sandbox();
    writeFileSync(box.env.AIP_FAKE_SCRIPT!, JSON.stringify({ code: [{ hang: true }] }));
    const { runId } = runOf(
      (await aip(box, 'run', 'start', 'feature', '--task', 'x', '--json')).stdout,
    );
    await waitUntil('the step to run', async () =>
      (await aip(box, 'daemon', 'status')).stdout.includes('busy: yes'),
    );
    const pid = /\(pid (\d+)\)/.exec((await aip(box, 'daemon', 'status')).stdout)?.[1];
    const refused = await aip(box, 'daemon', 'stop');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('--force');
    const kept = await aip(box, 'daemon', 'restart');
    expect(kept.code).toBe(1);
    expect(kept.stderr).toContain('--force');
    expect((await aip(box, 'daemon', 'status')).stdout).toContain(`(pid ${pid})`);
    const forced = await aip(box, 'daemon', 'stop', '--force');
    expect(forced).toMatchObject({ code: 0, stdout: `aip daemon: stopped (pid ${pid})\n` });
    // The next call starts the daemon again; it marks the step it found running as interrupted.
    const shown = await aip(box, 'run', 'show', runId, '--json');
    expect(shown.code).toBe(0);
    expect(shown.stdout).toMatch(/"reason":\s*"interrupted"/);
  });

  it('stops the daemon cleanly on SIGTERM', async () => {
    const box = sandbox();
    const daemon = spawn(process.execPath, [main, 'daemon'], {
      env: box.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve) => daemon.stdout.once('data', () => resolve()));
    const second = await aip(box, 'daemon');
    expect(second.code).toBe(1);
    expect(second.stderr).toContain('already running');
    const exited = new Promise<number | null>((resolve) =>
      daemon.once('exit', (code) => resolve(code)),
    );
    daemon.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(existsSync(box.socket)).toBe(false);
  });

  it('exits with the error when the web port is taken', async () => {
    const box = sandbox();
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const port = String((taken.address() as AddressInfo).port);
    try {
      const result = await aip(box, 'web', '--port', port);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`127.0.0.1:${port}`);
      expect(result.stderr).toContain('already in use');
      expect(result.stderr).toContain('--port');
      expect(taken.listening).toBe(true);
    } finally {
      taken.close();
    }
  });

  it('prints the web link and exits on SIGTERM', async () => {
    const box = sandbox();
    const web = spawn(process.execPath, [main, 'web', '--port', '0'], {
      cwd: box.repo,
      env: box.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<number | null>((resolve) => web.once('exit', resolve));
    let stdout = '';
    web.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    await waitUntil('the link of aip web', () => stdout.includes('aip web: http'));
    expect(stdout).toMatch(/^aip web: http:\/\/127\.0\.0\.1:\d+\/\?token=/);
    web.kill('SIGTERM');
    expect(await exited).toBe(0);
  });

  it('uses the access token from AIP_WEB_TOKEN', async () => {
    const box = sandbox();
    const token = 'abcdefghijklmnop1234';
    const web = spawn(process.execPath, [main, 'web', '--port', '0'], {
      cwd: box.repo,
      env: { ...box.env, AIP_WEB_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<number | null>((resolve) => web.once('exit', resolve));
    let stdout = '';
    web.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    await waitUntil('the link of aip web', () => stdout.includes('aip web: http'));
    const url = /^aip web: (\S+)$/m.exec(stdout)?.[1] ?? '';
    expect(url).toMatch(new RegExp(`\\?token=${token}$`));
    const response = await fetch(new URL('/api/runs', url), { headers: { 'x-aip-token': token } });
    expect(response.status).toBe(200);
    web.kill('SIGTERM');
    expect(await exited).toBe(0);
  });

  it('rejects an invalid AIP_WEB_TOKEN', async () => {
    const box = sandbox();
    const result = await aip(
      { ...box, env: { ...box.env, AIP_WEB_TOKEN: 'short' } },
      'web',
      '--port',
      '0',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('AIP_WEB_TOKEN');
  });

  async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  function writeGlobalSettings(box: Sandbox, text: string): void {
    const directory = join(box.env.XDG_CONFIG_HOME ?? '', 'aip');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'settings.yaml'), text);
  }

  function panelFile(box: Sandbox): string {
    return join(box.state, 'web.json');
  }

  async function runWeb(
    box: Sandbox,
    args: string[],
    extra: NodeJS.ProcessEnv = {},
  ): Promise<{ child: ChildProcess; stdout: () => string; exited: Promise<number | null> }> {
    const child = spawn(process.execPath, [main, 'web', ...args], {
      cwd: box.repo,
      env: { ...box.env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    return { child, stdout: () => out, exited };
  }

  describe('aip web start|stop|restart|status', () => {
    const noAutostart = (box: Sandbox): Sandbox => {
      const env = { ...box.env };
      delete env.AIP_WEB_AUTOSTART;
      return { ...box, env };
    };
    const listening = async (port: number): Promise<boolean> =>
      fetch(`http://127.0.0.1:${port}/`).then(
        () => true,
        () => false,
      );

    it('starts, reports, stops and restarts the panel of the daemon', async () => {
      const box = sandbox();
      const port = await freePort();
      writeGlobalSettings(box, `web: { autostart: false, port: ${port} }\n`);
      const env = noAutostart(box);

      const started = await aip(env, 'web', 'start');
      expect(started.code).toBe(0);
      const pid = /^aip web: started \(pid (\d+)\)$/m.exec(started.stdout)?.[1];
      expect(pid).toBeDefined();
      const url = /^aip web: (http\S+)$/m.exec(started.stdout)?.[1] ?? '';
      expect(url).toContain(`http://127.0.0.1:${port}/?token=`);
      expect(await listening(port)).toBe(true);

      const again = await aip(env, 'web', 'start');
      expect(again.code).toBe(0);
      expect(again.stdout).toContain(`aip web: already running (pid ${pid})`);
      expect(again.stdout).toContain(url);

      const status = await aip(env, 'web', 'status');
      expect(status.code).toBe(0);
      expect(status.stdout).toContain(`aip web: running (pid ${pid})`);
      expect(status.stdout).toContain(`address: 127.0.0.1:${port}`);
      expect(status.stdout).toContain('auth: token');
      const json = JSON.parse((await aip(env, 'web', 'status', '--json')).stdout) as unknown;
      expect(json).toMatchObject({ running: true, daemon: true, port, reason: null });

      // a new port after a settings change, the token stays
      const next = await freePort();
      writeGlobalSettings(box, `web: { autostart: false, port: ${next} }\n`);
      const restarted = await aip(env, 'web', 'restart');
      expect(restarted.code).toBe(0);
      expect(restarted.stdout).toContain(`aip web: restarted (pid ${pid})`);
      const token = new URL(url).searchParams.get('token');
      expect(restarted.stdout).toContain(`http://127.0.0.1:${next}/?token=${token}`);
      expect(await listening(port)).toBe(false);
      expect(await listening(next)).toBe(true);

      const stopped = await aip(env, 'web', 'stop');
      expect(stopped.code).toBe(0);
      expect(stopped.stdout).toContain(`aip web: stopped (pid ${pid})`);
      expect(await listening(next)).toBe(false);
      expect(existsSync(panelFile(box))).toBe(false);
      const daemonStatus = await aip(env, 'daemon', 'status');
      expect(daemonStatus.stdout).toContain(`aip daemon: running (pid ${pid})`);
      const after = await aip(env, 'web', 'status');
      expect(after.code).toBe(3);
      expect(after.stdout).toContain('aip web: not running');
      expect((await aip(env, 'web', 'stop')).stdout).toContain('aip web: not running');
    });

    it('restarts the daemon with --web, also with web.autostart off', async () => {
      const box = sandbox();
      const port = await freePort();
      writeGlobalSettings(box, `web: { autostart: false, port: ${port} }\n`);
      const env = noAutostart(box);
      const restarted = await aip(env, 'daemon', 'restart', '--web');
      expect(restarted.code).toBe(0);
      const pid = /(?:restarted|started) \(pid (\d+)\)/.exec(restarted.stdout)?.[1];
      expect(pid).toBeDefined();
      expect(restarted.stdout).toContain(`aip web: http://127.0.0.1:${port}/?token=`);
      const status = await aip(env, 'web', 'status');
      expect(status.stdout).toContain(`aip web: running (pid ${pid})`);
      const again = await aip(env, 'daemon', 'restart', '--web');
      expect(again.stdout).toMatch(/restarted \(pid (\d+)\)/);
      expect(again.stdout).toContain(`aip web: http://127.0.0.1:${port}/?token=`);
      await aip(env, 'daemon', 'stop');
    });

    it('fails restart --web with code 1 when the port is taken, the daemon runs', async () => {
      const box = sandbox();
      const taken = createServer();
      await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
      const port = (taken.address() as AddressInfo).port;
      try {
        writeGlobalSettings(box, `web: { autostart: false, port: ${port} }\n`);
        const env = noAutostart(box);
        const result = await aip(env, 'daemon', 'restart', '--web');
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(`127.0.0.1:${port}`);
        expect(result.stdout).toMatch(/aip daemon: (re)?started/);
        expect((await aip(env, 'daemon', 'status')).code).toBe(0);
      } finally {
        taken.close();
        await aip(box, 'daemon', 'stop');
      }
    });

    it('does not start the daemon for status and stop', async () => {
      const box = sandbox();
      const status = await aip(box, 'web', 'status', '--json');
      expect(status.code).toBe(3);
      expect(JSON.parse(status.stdout)).toMatchObject({
        running: false,
        daemon: false,
        pid: null,
        url: null,
      });
      expect(status.stdout.trim().split('\n')).toHaveLength(1);
      const stop = await aip(box, 'web', 'stop');
      expect(stop.code).toBe(0);
      expect(stop.stdout).toContain('aip web: not running');
      expect(existsSync(join(box.state, 'aip.pid'))).toBe(false);
    });

    it('starts the daemon for start and takes the token from AIP_WEB_TOKEN', async () => {
      const box = sandbox();
      const port = await freePort();
      writeGlobalSettings(box, `web: { port: ${port} }\n`);
      const token = 'abcdefghijklmnop1234';
      const env = noAutostart(box);
      const result = await aip(
        { ...env, env: { ...env.env, AIP_WEB_TOKEN: token } },
        'web',
        'start',
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`?token=${token}`);
      expect((await aip(env, 'daemon', 'status')).code).toBe(0);
    });

    it('fails with code 1 when the port is taken, and the daemon keeps running', async () => {
      const box = sandbox();
      const taken = createServer();
      await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
      const port = (taken.address() as AddressInfo).port;
      try {
        writeGlobalSettings(box, `web: { autostart: false, port: ${port} }\n`);
        const env = noAutostart(box);
        const result = await aip(env, 'web', 'start');
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(`127.0.0.1:${port}`);
        expect((await aip(env, 'daemon', 'status')).code).toBe(0);
        const status = await aip(env, 'web', 'status');
        expect(status.code).toBe(3);
        expect(status.stdout).toContain(`reason: port 127.0.0.1:${port} is already in use`);
        expect(taken.listening).toBe(true);
      } finally {
        taken.close();
      }
    });

    it('rejects an invalid AIP_WEB_TOKEN before it talks to the daemon', async () => {
      const box = sandbox();
      for (const sub of ['start', 'restart']) {
        const result = await aip(
          { ...box, env: { ...box.env, AIP_WEB_TOKEN: 'short' } },
          'web',
          sub,
        );
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('AIP_WEB_TOKEN');
      }
      expect(existsSync(join(box.state, 'aip.pid'))).toBe(false);
    });

    it('lets a plain `aip web` raise its own server at once after `aip web stop`', async () => {
      const box = sandbox();
      const port = await freePort();
      writeGlobalSettings(box, `web: { port: ${port} }\n`);
      const env = noAutostart(box);
      expect((await aip(env, 'web', 'start')).code).toBe(0);
      expect((await aip(env, 'web', 'stop')).code).toBe(0);
      const began = Date.now();
      const web = await runWeb(env, ['--port', String(port)]);
      await waitUntil('the link of aip web', () => web.stdout().includes('aip web: http'), 4000);
      expect(Date.now() - began).toBeLessThan(4500);
      expect(web.stdout()).not.toContain('served by the aip daemon');
      web.child.kill('SIGTERM');
      expect(await web.exited).toBe(0);
    });
  });

  it('starts the web panel with the daemon and removes its state file on shutdown', async () => {
    const box = sandbox();
    const port = await freePort();
    writeGlobalSettings(box, `web: { port: ${port} }\n`);
    const env = { ...box.env };
    delete env.AIP_WEB_AUTOSTART;
    const started = { ...box, env };
    expect((await aip(started, 'repo', 'list')).code).toBe(0);
    await waitUntil('web.json', () => existsSync(panelFile(box)));
    const state = JSON.parse(readFileSync(panelFile(box), 'utf8')) as { url: string; port: number };
    expect(state.port).toBe(port);
    expect(statSync(panelFile(box)).mode & 0o777).toBe(0o600);
    expect((await fetch(state.url)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/runs`)).status).toBe(401);

    // `aip web` reports the panel of the daemon and exits at once.
    const web = await runWeb(started, []);
    expect(await web.exited).toBe(0);
    expect(web.stdout()).toContain(`aip web: ${state.url}`);
    expect(web.stdout()).toContain('served by the aip daemon');

    // another port gets a server of its own
    const other = await runWeb(started, ['--port', '0']);
    await waitUntil('the link of the second aip web', () =>
      other.stdout().includes('aip web: http'),
    );
    expect(other.stdout()).not.toContain('served by the aip daemon');
    other.child.kill('SIGTERM');
    expect(await other.exited).toBe(0);

    await request(box.socket, 'shutdown', {});
    await waitUntil('the port to be free', async () => {
      try {
        await fetch(state.url);
        return false;
      } catch {
        return true;
      }
    });
    await waitUntil('web.json to be removed', () => !existsSync(panelFile(box)));
  });

  it('keeps the daemon working when the panel port is taken', async () => {
    const box = sandbox();
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const port = (taken.address() as AddressInfo).port;
    try {
      writeGlobalSettings(box, `web: { port: ${port} }\n`);
      const env = { ...box.env };
      delete env.AIP_WEB_AUTOSTART;
      expect((await aip({ ...box, env }, 'repo', 'list')).code).toBe(0);
      await waitUntil('the daemon log to name the port', () => {
        const log = join(box.state, 'daemon.log');
        return existsSync(log) && readFileSync(log, 'utf8').includes(`127.0.0.1:${port}`);
      });
      expect(readFileSync(join(box.state, 'daemon.log'), 'utf8')).toContain(
        'web panel not started',
      );
      expect(existsSync(panelFile(box))).toBe(false);
      expect((await aip({ ...box, env }, 'repo', 'list')).code).toBe(0);
    } finally {
      taken.close();
    }
  });

  it('prints a link without a token when web.auth is none', async () => {
    const box = sandbox();
    writeGlobalSettings(box, 'web: { autostart: false, auth: none }\n');
    const web = await runWeb(box, ['--port', '0'], { AIP_WEB_TOKEN: 'abcdefghijklmnop1234' });
    await waitUntil('the link of aip web', () => web.stdout().includes('aip web: http'));
    const url = /^aip web: (\S+)$/m.exec(web.stdout())?.[1] ?? '';
    expect(url).not.toContain('token=');
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(page.headers.get('set-cookie')).toBeNull();
    expect((await fetch(new URL('/api/runs', url))).status).toBe(200);
    web.child.kill('SIGTERM');
    expect(await web.exited).toBe(0);
  });

  it('takes the port of aip web from the settings', async () => {
    const box = sandbox();
    const port = await freePort();
    writeGlobalSettings(box, `web: { autostart: false, port: ${port} }\n`);
    const web = await runWeb(box, []);
    await waitUntil('the link of aip web', () => web.stdout().includes('aip web: http'));
    expect(web.stdout()).toContain(`aip web: http://127.0.0.1:${port}/`);
    web.child.kill('SIGTERM');
    expect(await web.exited).toBe(0);
  });

  it('fails aip web on a wrong web section with the field path', async () => {
    const box = sandbox();
    writeGlobalSettings(box, 'web: { host: 0.0.0.0 }\n');
    const result = await aip(box, 'web', '--port', '0');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('swarm.web.host');
  });

  it('describes the access mode and the daemon panel in `web --help`', async () => {
    const help = await aip(sandbox(), 'web', '--help');
    expect(help.stdout).toContain('unless web.auth is none');
    expect(help.stdout).toContain('web.port');
    expect(help.stdout).toContain('The daemon serves the dashboard itself');
  });

  describe('aip web repository scope', () => {
    async function webQueue(
      box: Sandbox,
      cwd: string,
    ): Promise<{ status: number; body: { repository?: string }; stderr: string }> {
      const child = spawn(process.execPath, [main, 'web', '--port', '0'], {
        cwd,
        env: { ...box.env, AIP_WEB_TOKEN: 'abcdefghijklmnop1234' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        err += chunk.toString();
      });
      try {
        await waitUntil('the link of aip web', () => out.includes('aip web: http'));
        const url = /^aip web: (\S+)$/m.exec(out)?.[1] ?? '';
        const response = await fetch(new URL('/api/queue', url), {
          headers: { 'x-aip-token': 'abcdefghijklmnop1234' },
        });
        return { status: response.status, body: (await response.json()) as never, stderr: err };
      } finally {
        child.kill('SIGTERM');
        await exited;
      }
    }

    function outsideGit(): string {
      return realpathSync(mkdtempSync(join(tmpdir(), 'aip-outside-')));
    }

    /** Two registered repositories: the sandbox one, then `second`, added last. */
    async function twoRegistered(box: Sandbox): Promise<string> {
      expect((await aip(box, 'repo', 'add', box.repo)).code).toBe(0);
      const second = realpathSync(mkdtempSync(join(tmpdir(), 'aip-second-')));
      execFileSync('git', ['init', '-q', '-b', 'main', second]);
      expect((await aip(box, 'repo', 'add', second)).code).toBe(0);
      return second;
    }

    it('ignores the git repository it runs in and answers with the repository added last', async () => {
      const box = sandbox();
      const second = await twoRegistered(box);
      const other = realpathSync(mkdtempSync(join(tmpdir(), 'aip-other-')));
      execFileSync('git', ['init', '-q', '-b', 'main', other]);
      mkdirSync(join(other, 'sub'));
      const result = await webQueue(box, join(other, 'sub'));
      expect(result.status).toBe(200);
      expect(result.body.repository).toBe(second);
      const list = await aip(box, 'repo', 'list', '--json');
      expect((JSON.parse(list.stdout) as { path: string }[]).map((entry) => entry.path)).toEqual([
        box.repo,
        second,
      ]);
    });

    it('answers with the repository added last outside git without a warning', async () => {
      const box = sandbox();
      const second = await twoRegistered(box);
      const result = await webQueue(box, outsideGit());
      expect(result.status).toBe(200);
      expect(result.body.repository).toBe(second);
      expect(result.stderr).not.toContain('is not inside a git repository');
    });

    it('answers 409 while the registry is empty, even inside a git repository', async () => {
      const box = sandbox();
      expect((await webQueue(box, outsideGit())).status).toBe(409);
      expect((await webQueue(box, box.repo)).status).toBe(409);
    });
  });

  it('adds a repository by a subdirectory, lists it and refuses a path outside git', async () => {
    const box = sandbox();
    mkdirSync(join(box.repo, 'sub'));
    const added = await aip(box, 'repo', 'add', join(box.repo, 'sub'));
    expect(added.code).toBe(0);
    const list = await aip(box, 'repo', 'list', '--json');
    expect(JSON.parse(list.stdout)).toEqual([
      { path: box.repo, addedAt: expect.any(Number), unfinished: 0, waiting: 0, queued: 0 },
    ]);
    const text = await aip(box, 'repo', 'list');
    expect(text.stdout).toContain('REPOSITORY');
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'aip-outside-')));
    const refused = await aip(box, 'repo', 'add', outside);
    expect(refused.code).toBe(1);
    expect(refused.stderr).not.toBe('');
    const removed = await aip(box, 'repo', 'remove', box.repo, '--json');
    expect(removed.code).toBe(0);
    expect(JSON.parse(removed.stdout)).toEqual([]);
  });

  it('does not start the daemon or touch the list for aip config check', async () => {
    const box = sandbox();
    const checked = await aip(box, 'config', 'check');
    expect(checked.code).toBe(0);
    expect(existsSync(box.socket)).toBe(false);
    const list = await aip(box, 'repo', 'list', '--json');
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  it('creates, lists, edits and removes tags', async () => {
    const box = sandbox();
    expect((await aip(box, 'tag', 'list')).stdout).toContain('No tags yet.');
    const added = await aip(box, 'tag', 'add', 'auth', '--color', 'blue');
    expect(added.code).toBe(0);
    const list = await aip(box, 'tag', 'list');
    expect(list.stdout).toMatch(/auth\s+blue/);
    const bad = await aip(box, 'tag', 'add', 'other', '--color', 'cyan');
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain('gray, red, orange');
    expect((await aip(box, 'tag', 'add', 'AUTH')).stderr).toContain('tag `auth` already exists');
    const none = await aip(box, 'tag', 'edit', 'auth');
    expect(none.code).not.toBe(0);
    const edited = await aip(box, 'tag', 'edit', 'auth', '--name', 'login', '--color', 'teal');
    expect(edited.stdout).toMatch(/login\s+teal/);
    const json = JSON.parse((await aip(box, 'tag', 'list', '--json')).stdout) as {
      name: string;
    }[];
    expect(json.map((tag) => tag.name)).toEqual(['login']);
    const removed = await aip(box, 'tag', 'remove', 'login');
    expect(removed.stdout).toContain('No tags yet.');
    expect((await aip(box, 'tag', '--help')).stdout.replace(/\s+/g, ' ')).toContain(
      'gray, red, orange, yellow, green, teal, blue, violet, pink, brown',
    );
  });

  it('puts tags on queued tasks and edits them', async () => {
    const box = sandbox();
    await aip(box, 'tag', 'add', 'auth');
    await aip(box, 'tag', 'add', 'v2');
    const added = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'Форма входа',
      '--tag',
      'auth',
      '--tag',
      'v2',
    );
    expect(added.code).toBe(0);
    expect((await aip(box, 'queue', 'list')).stdout).toContain('#auth #v2');
    const view = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
      items: { id: string; tags: { name: string }[] }[];
    };
    expect(view.items[0]!.tags.map((tag) => tag.name)).toEqual(['auth', 'v2']);
    const id = view.items[0]!.id;
    const both = await aip(box, 'queue', 'edit', id, '--tag', 'auth', '--no-tags');
    expect(both.code).not.toBe(0);
    expect((await aip(box, 'queue', 'edit', id, '--task', 'другое')).stdout).toContain('#auth #v2');
    const replaced = await aip(box, 'queue', 'edit', id, '--tag', 'v2');
    expect(replaced.stdout).toContain('#v2');
    expect(replaced.stdout).not.toContain('#auth');
    const cleared = await aip(box, 'queue', 'edit', id, '--no-tags', '--json');
    expect((JSON.parse(cleared.stdout) as typeof view).items[0]!.tags).toEqual([]);
    const unknown = await aip(box, 'queue', 'add', 'feature', '--task', 'x', '--tag', 'nope');
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('aip tag add nope');
    expect(
      (JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as typeof view).items,
    ).toHaveLength(1);
  });

  it('skips steps of queued tasks and edits the list', async () => {
    const box = sandbox();
    const added = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'Форма входа',
      '--skip',
      'review',
      '--json',
    );
    expect(added.code).toBe(0);
    const view = JSON.parse(added.stdout) as { items: { id: string; skip: string[] }[] };
    expect(view.items[0]!.skip).toEqual(['review']);
    const id = view.items[0]!.id;
    expect((await aip(box, 'queue', 'list')).stdout).toContain('skip: review');
    const both = await aip(box, 'queue', 'edit', id, '--skip', 'review', '--no-skips');
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('--no-skips cannot be combined with --skip');
    expect((await aip(box, 'queue', 'edit', id, '--task', 'другое')).stdout).toContain(
      'skip: review',
    );
    const cleared = await aip(box, 'queue', 'edit', id, '--no-skips', '--json');
    expect((JSON.parse(cleared.stdout) as typeof view).items[0]!.skip).toEqual([]);
    const unknown = await aip(box, 'queue', 'add', 'feature', '--task', 'x', '--skip', 'deploy');
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('unknown step `deploy` in skip');
    const accepted = await aip(
      box,
      'run',
      'start',
      'feature',
      '--task',
      'z',
      '--skip',
      'review',
      '--json',
    );
    expect(accepted.code).toBe(0);
    const started = await aip(box, 'run', 'start', 'feature', '--task', 'y', '--skip', 'nope');
    expect(started.code).not.toBe(0);
    expect(started.stderr).toContain('unknown step `nope` in skip');
  });

  it('postpones queued tasks and takes them back, and refuses the flag on `run start`', async () => {
    const box = sandbox();
    const added = JSON.parse(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'later', '--postpone', '--json')).stdout,
    ) as { item: string; items: { id: string; postponed: boolean }[] };
    expect(added.items.find((item) => item.id === added.item)!.postponed).toBe(true);
    expect((await aip(box, 'queue', 'list')).stdout).toContain('· postponed');
    const cleared = JSON.parse(
      (await aip(box, 'queue', 'edit', added.item, '--no-postpone', '--json')).stdout,
    ) as typeof added;
    expect(cleared.items[0]!.postponed).toBe(false);
    expect((await aip(box, 'queue', 'list')).stdout).not.toContain('postponed');
    const again = JSON.parse(
      (await aip(box, 'queue', 'edit', added.item, '--postpone', '--json')).stdout,
    ) as typeof added;
    expect(again.items[0]!.postponed).toBe(true);
    const start = await aip(box, 'run', 'start', 'feature', '--task', 'x', '--postpone');
    expect(start.code).not.toBe(0);
    expect(start.stderr).toContain('unknown option');
  });

  it('queues a task after another one, clears the dependencies and refuses both flags', async () => {
    const box = sandbox();
    const first = JSON.parse(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'модель', '--json')).stdout,
    ) as { item: string };
    const added = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'API',
      '--after',
      first.item,
      '--json',
    );
    expect(added.code).toBe(0);
    const view = JSON.parse(added.stdout) as {
      item: string;
      items: { id: string; readiness: string; after: { id: string; state: string }[] }[];
    };
    const second = view.items.find((item) => item.id === view.item)!;
    expect(second).toMatchObject({ readiness: 'waiting' });
    expect(second.after).toMatchObject([{ id: first.item, state: 'waiting' }]);
    expect((await aip(box, 'queue', 'list')).stdout).toContain(`after #1 ${first.item} (waiting)`);
    const both = await aip(box, 'queue', 'edit', view.item, '--after', first.item, '--no-after');
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('--no-after cannot be combined with --after');
    expect((await aip(box, 'queue', 'list')).stdout).toContain(`after #1 ${first.item}`);
    const cleared = await aip(box, 'queue', 'edit', view.item, '--no-after', '--json');
    expect(cleared.code).toBe(0);
    expect(
      (JSON.parse(cleared.stdout) as typeof view).items.find((item) => item.id === view.item)!
        .after,
    ).toEqual([]);
    const cycle = await aip(box, 'queue', 'edit', first.item, '--after', view.item);
    expect(cycle.code).toBe(0);
    const closing = await aip(box, 'queue', 'edit', view.item, '--after', first.item);
    expect(closing.code).not.toBe(0);
    expect(closing.stderr).toContain('dependency cycle');
    const unknown = await aip(box, 'queue', 'add', 'feature', '--task', 'x', '--after', 'nope');
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('unknown dependency `nope`');
  });

  it('queues run start with an unfinished dependency instead of creating a run', async () => {
    const box = sandbox();
    const first = JSON.parse(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'модель', '--json')).stdout,
    ) as { item: string };
    const started = await aip(
      box,
      'run',
      'start',
      'feature',
      '--task',
      'API',
      '--after',
      first.item,
      '--json',
    );
    expect(started.code).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({ run: null });
    const text = await aip(box, 'run', 'start', 'feature', '--task', 'UI', '--after', first.item);
    expect(text.stdout).toMatch(/Task #\d+ \S+ queued at position/);
  });

  it('removes a tag from a queued task', async () => {
    const box = sandbox();
    await aip(box, 'tag', 'add', 'auth');
    await aip(box, 'queue', 'add', 'feature', '--task', 'x', '--tag', 'auth');
    await aip(box, 'tag', 'remove', 'auth');
    const list = await aip(box, 'queue', 'list');
    expect(list.stdout).not.toContain('#auth');
    expect(list.stdout).toContain('x');
  });

  it('tags and untags runs and filters the list by any of the tags', async () => {
    const box = sandbox();
    await aip(box, 'tag', 'add', 'auth');
    await aip(box, 'tag', 'add', 'v2');
    const started = async (title: string, ...tags: string[]) => {
      const queued = JSON.parse(
        (
          await aip(
            box,
            'run',
            'start',
            'feature',
            '--task',
            title,
            '--title',
            title,
            '--json',
            ...tags.flatMap((tag) => ['--tag', tag]),
          )
        ).stdout,
      ) as { run: { runId: string } | null };
      return queued.run!.runId;
    };
    // Three places: the runs go at once instead of one after another.
    await aip(box, 'queue', 'settings', '--parallel', '3');
    const a = await started('first', 'auth');
    const b = await started('second');
    const c = await started('third');
    await waitUntil('the runs are finished', async () => {
      const runs = (await request(box.socket, 'status', {})) as { finished: boolean }[];
      return runs.length === 3 && runs.every((run) => run.finished);
    });
    const tagged = await aip(box, 'run', 'tag', b, 'v2');
    expect(tagged.code).toBe(0);
    expect(tagged.stdout).toContain('#v2');
    expect((await aip(box, 'run', 'show', b)).stdout).toContain('#v2');
    const filtered = await aip(box, 'run', 'list', '--tag', 'AUTH', '--tag', 'v2');
    expect(filtered.stdout).toContain(a);
    expect(filtered.stdout).toContain(b);
    expect(filtered.stdout).not.toContain(c);
    expect(filtered.stdout).toContain('#auth');
    const one = JSON.parse((await aip(box, 'run', 'list', '--tag', 'v2', '--json')).stdout) as {
      id: string;
    }[];
    expect(one.map((run) => run.id)).toEqual([b]);
    const untagged = await aip(box, 'run', 'untag', b, 'v2');
    expect(untagged.stdout).toContain('none');
    await aip(box, 'tag', 'add', 'idle');
    const empty = await aip(box, 'run', 'list', '--tag', 'idle');
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain('No runs with these tags.');
    const unknown = await aip(box, 'run', 'tag', b, 'nope');
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('unknown tag `nope`');
  }, 120_000);
});
