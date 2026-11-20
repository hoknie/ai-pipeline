import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { request } from '../../src/presentation/ipc/client/index.ts';
import type {
  AccessActionsView,
  AccessCheckView,
  RunCreated,
} from '../../src/presentation/ipc/contract/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/index.ts';

import { aip, ownDaemon, sandbox, type Sandbox } from './sandbox.ts';

let web: WebServer | null = null;

afterEach(async () => {
  await web?.close();
  web = null;
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

const ACCESS = `rules:
  - id: contractors-no-apply
    effect: deny
    actions: [run.apply]
    subject: { groups: [contractors] }
`;

/** A server with the policies; `as` gives the environment of a user of the CLI with the attributes. */
async function serverMode(access = ACCESS) {
  const box = sandbox();
  await ownDaemon(box);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const directory = join(String(box.env.XDG_CONFIG_HOME), 'aip');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'settings.yaml'),
    `server: { enabled: true, public_url: "${url}" }\n`,
  );
  writeFileSync(join(directory, 'access.yaml'), access);
  web = await startWebServer({
    socket: box.socket,
    host: '127.0.0.1',
    port,
    server: { publicUrl: url, trustedProxies: [] },
  });
  const as = async (email: string, attributes: Record<string, string[]>): Promise<Sandbox> => {
    const made = (await request(box.socket, 'login_link_create', { email })) as { url: string };
    const answer = await fetch(made.url, { redirect: 'manual' });
    const cookie = (answer.headers.get('set-cookie') as string).split(';')[0] as string;
    await request(box.socket, 'users_set', { email, attributes });
    const token = await fetch(`${url}/api/ipc`, {
      method: 'POST',
      headers: { cookie, origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'tokens_create', params: { name: 'cli' } }),
    });
    const { value } = (await token.json()) as { value: string };
    return { ...box, env: { ...box.env, AIP_SERVER: url, AIP_TOKEN: value } };
  };
  return { box, url, as };
}

describe('aip access', () => {
  it('lists the actions with their resource and description', async () => {
    const server = await serverMode();
    const admin = await server.as('admin@corp.com', { role: ['admin'] });
    const table = await aip(admin, 'access', 'actions');
    expect(table.code).toBe(0);
    expect(table.stdout).toContain('run.apply');
    expect(table.stdout).toContain('DESCRIPTION');
    const json = JSON.parse(
      (await aip(admin, 'access', 'actions', '--json')).stdout,
    ) as AccessActionsView;
    expect(json.actions.find((action) => action.name === 'run.cancel')).toMatchObject({
      resource: 'run',
    });
  });

  it('says why an action is refused: the decision and the rule', async () => {
    const server = await serverMode();
    const admin = await server.as('admin@corp.com', { role: ['admin'] });
    await server.as('bob@corp.com', { role: ['developer'], groups: ['contractors'] });
    await request(server.box.socket, 'repository_add', { path: server.box.repo });
    const result = await aip(
      admin,
      'access',
      'check',
      '--user',
      'bob@corp.com',
      '--action',
      'run.apply',
      '--repo',
      'repo',
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('deny');
    expect(result.stdout).toContain('contractors-no-apply');
    expect(result.stdout).toContain('preset:developer');
    const json = JSON.parse(
      (
        await aip(
          admin,
          'access',
          'check',
          '--user',
          'bob@corp.com',
          '--action',
          'queue.add',
          '--json',
        )
      ).stdout,
    ) as AccessCheckView;
    expect(json).toMatchObject({ decision: 'allow', reason: 'allow' });
  });

  it('refuses a developer the explanation, as the administrator only', async () => {
    const server = await serverMode();
    const dev = await server.as('dev@corp.com', { role: ['developer'] });
    const result = await aip(
      dev,
      'access',
      'check',
      '--user',
      'dev@corp.com',
      '--action',
      'run.apply',
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('users.manage');
  });

  it('refuses a viewer to cancel a run, with the action in the message, and the run goes on', async () => {
    const server = await serverMode();
    const viewer = await server.as('viewer@corp.com', { role: ['viewer'] });
    const created = (await request(server.box.socket, 'run', {
      repository: server.box.repo,
      pipeline: 'feature',
      task: 'work',
    })) as { run: RunCreated };
    const runId = created.run.runId;
    const result = await aip(viewer, 'run', 'cancel', runId);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('run.cancel');
    const status = await aip(viewer, 'run', 'show', runId, '--json');
    expect(status.stderr).toBe('');
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout).state).not.toBe('cancelled');
  });
});

describe('the rights through the remote transport', () => {
  it('lets a developer add a task, refuses a viewer and a contractor with a deny rule', async () => {
    const server = await serverMode(`rules:
  - id: contractors-no-queue
    effect: deny
    actions: [queue.add]
    subject: { groups: [contractors] }
`);
    await request(server.box.socket, 'repository_add', { path: server.box.repo });
    const developer = await server.as('dev@corp.com', { role: ['developer'] });
    const viewer = await server.as('viewer@corp.com', { role: ['viewer'] });
    const contractor = await server.as('c@corp.com', {
      role: ['developer'],
      groups: ['contractors'],
    });
    const add = (box: Sandbox) =>
      aip(box, 'queue', 'add', 'feature', '--task', 'work', '--repo', 'repo', '--json');
    const done = await add(developer);
    expect(done.stderr).toBe('');
    expect(done.code).toBe(0);
    for (const box of [viewer, contractor]) {
      const refused = await add(box);
      expect(refused.code).not.toBe(0);
      expect(refused.stderr).toContain('queue.add');
    }
    // nothing was added by the refused calls; the viewer still reads
    const queue = await aip(viewer, 'queue', 'list', '--repo', 'repo', '--json');
    expect(queue.code).toBe(0);
    expect(JSON.parse(queue.stdout).items).toHaveLength(1);
    const journal = (await request(server.box.socket, 'audit_list', {
      action: 'queue.add',
    })) as { events: { outcome: string }[] };
    expect(journal.events.map((event) => event.outcome).sort()).toEqual(['denied', 'denied', 'ok']);
  });
});

describe('aip config check', () => {
  it('fails on an unknown action of access.yaml and names the field and close actions', async () => {
    const box = sandbox();
    const directory = join(String(box.env.XDG_CONFIG_HOME), 'aip');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'access.yaml'),
      'rules:\n  - id: x\n    effect: allow\n    actions: [run.destroy]\n',
    );
    const result = await aip(box, 'config', 'check');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('rules[0].actions[0]');
    expect(result.stderr).toContain('run.cancel');
  });
});
