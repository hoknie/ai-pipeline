import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';

import type { Command } from 'commander';

import { rejected } from '../../../../platform/errors/index.ts';
import type { Style } from '../../../format/index.ts';
import { request } from '../../../ipc/client/index.ts';
import { openBrowser } from '../../../web/index.ts';
import { bind } from '../../context.ts';
import { usage, writeLine, type CliIo } from '../../io.ts';
import { readProfile, removeProfile, remoteOf, writeProfile } from './profile.ts';

const LOGIN_WAIT_MS = 5 * 60_000;

interface Callback {
  code: string;
}

/** Waits for the browser to come back to `127.0.0.1` with the code; a wrong `state` is an error. */
function waitForCode(state: string): {
  port: Promise<number>;
  code: Promise<Callback>;
  close: () => void;
} {
  let settle: { resolve: (value: Callback) => void; reject: (error: Error) => void };
  const code = new Promise<Callback>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      response.writeHead(404).end();
      return;
    }
    if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
      response.writeHead(400, { 'content-type': 'text/plain' }).end('aip login: wrong state');
      settle.reject(rejected('the login answer has another state: login cancelled'));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('aip login: done, you can close this tab.');
    settle.resolve({ code: url.searchParams.get('code') as string });
  });
  const port = new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  const timer = setTimeout(() => settle.reject(rejected('login timed out')), LOGIN_WAIT_MS);
  timer.unref();
  return {
    port,
    code,
    close: () => {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
    },
  };
}

async function exchange(
  url: string,
  code: string,
  verifier: string,
): Promise<{ token: string; user: { email: string } }> {
  const response = await fetch(`${url}/auth/cli/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
  });
  const body = (await response.json()) as {
    token?: string;
    user?: { email: string };
    error?: string;
  };
  if (!response.ok || body.token === undefined || body.user === undefined) {
    throw rejected(body.error ?? `the server answered ${response.status}`);
  }
  return { token: body.token, user: body.user };
}

async function login(address: string, options: { browser?: boolean }, io: CliIo): Promise<void> {
  const url = address.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url))
    throw usage('the server address must start with http:// or https://');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  const waiting = waitForCode(state);
  try {
    const port = await waiting.port;
    const machine = io.env.AIP_MACHINE || hostname();
    const link = `${url}/auth/cli?${new URLSearchParams({ port: String(port), state, challenge, machine })}`;
    writeLine(io, `aip login: open ${link}`);
    if (options.browser !== false) openBrowser(link, io.stderr);
    const { code } = await waiting.code;
    const { token, user } = await exchange(url, code, verifier);
    writeProfile(io.env, { url, token, email: user.email });
    writeLine(io, `aip login: signed in as ${user.email}`);
  } finally {
    waiting.close();
  }
}

async function logout(io: CliIo): Promise<void> {
  const profile = readProfile(io.env);
  if (profile === null) {
    writeLine(io, 'aip logout: not signed in');
    return;
  }
  try {
    await request({ url: profile.url, token: profile.token }, 'tokens_revoke', {
      token: profile.token.slice(0, 12),
    });
  } catch (error) {
    io.stderr(
      `aip logout: the token could not be revoked on the server: ${(error as Error).message}\n`,
    );
  }
  removeProfile(io.env);
  writeLine(io, 'aip logout: signed out');
}

async function whoami(io: CliIo, style: Style): Promise<void> {
  const remote = remoteOf(io.env);
  if (remote === null) {
    writeLine(io, 'local mode');
    return;
  }
  const answer = (await request(remote, 'whoami', {})) as {
    user: { email: string; name: string; attributes: Record<string, string[]> } | null;
  };
  void style;
  writeLine(io, `server: ${remote.url}`);
  if (answer.user === null) return;
  writeLine(io, `email: ${answer.user.email}`);
  const attributes = Object.entries(answer.user.attributes)
    .map(([name, values]) => `${name}=${values.join(',')}`)
    .join(' ');
  writeLine(io, `attributes: ${attributes === '' ? 'none' : attributes}`);
}

export function registerLogin(program: Command, io: CliIo, style: Style): void {
  const { examples } = bind(io, style);
  program
    .command('login')
    .description('Sign in to an aip server and save a personal token for this machine')
    .argument('<url>', 'address of the server, such as https://aip.example.com')
    .option('--no-browser', 'print the link instead of opening the browser')
    .addHelpText(
      'after',
      examples([
        'aip login https://aip.example.com',
        'aip login https://aip.example.com --no-browser',
      ]),
    )
    .action((url: string, options: { browser?: boolean }) => login(url, options, io));
  program
    .command('logout')
    .description('Revoke the token of the saved server and forget it')
    .addHelpText('after', examples(['aip logout']))
    .action(() => logout(io));
  program
    .command('whoami')
    .description('Show the server and the user of this machine, or local mode')
    .addHelpText('after', examples(['aip whoami']))
    .action(() => whoami(io, style));
}
