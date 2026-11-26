import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';
import { harness, PIPELINE_CONFIG, type Harness } from '../daemon/harness.ts';
import { copyTemplateRepo } from '../fixtures/template-repo.ts';

let h: Harness | undefined;
let web: WebServer | undefined;
afterEach(async () => {
  await web?.close();
  await h?.close();
  web = undefined;
  h = undefined;
});

it('searches only local branches of a registered project through IPC and web', async () => {
  h = await harness();
  const other = join(dirname(h.repo), 'other');
  copyTemplateRepo(other, PIPELINE_CONFIG);
  await h.call('repository_add', { path: h.repo });
  await h.call('repository_add', { path: other });
  const git = (repo: string, ...args: string[]) => execFileSync('git', args, { cwd: repo });
  git(h.repo, 'branch', 'feature/z');
  git(h.repo, 'branch', 'feature/a');
  git(other, 'branch', 'feature/other');
  git(h.repo, 'update-ref', 'refs/remotes/origin/feature/remote', 'HEAD');
  git(h.repo, 'update-ref', 'refs/aip/feature/internal', 'HEAD');
  expect(await h.call('repository_branches', { repository: h.repo, query: 'feature/' })).toEqual([
    'feature/a',
    'feature/z',
  ]);
  expect(await h.call('repository_branches', { repository: other, query: 'feature/' })).toEqual([
    'feature/other',
  ]);
  for (let n = 0; n < 55; n++) git(other, 'branch', `bulk/${String(n).padStart(2, '0')}`);
  const bounded = (await h.call('repository_branches', {
    repository: other,
    query: 'bulk/',
  })) as string[];
  expect(bounded).toHaveLength(50);
  expect(bounded[0]).toBe('bulk/00');
  expect(bounded[49]).toBe('bulk/49');
  await expect(
    h.call('repository_branches', { repository: 'unknown-project', query: '' }),
  ).rejects.toThrow();
  web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
  const base = `http://127.0.0.1:${web.port}`;
  const headers = { 'x-aip-token': web.token ?? '' };
  const response = await fetch(`${base}/api/repository/branches?query=feature%2F`, { headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(['feature/a', 'feature/z']);
  const exact = await fetch(`${base}/api/repository/branches?query=feature%2Fa&exact=true`, {
    headers,
  });
  expect(await exact.json()).toEqual(['feature/a']);
  const invalid = await fetch(`${base}/api/repository/branches?exact=maybe`, { headers });
  expect(invalid.status).toBe(400);
  const unknown = await fetch(`${base}/api/repository/branches?repository=unknown-project`, {
    headers,
  });
  expect(unknown.status).not.toBe(200);
});
