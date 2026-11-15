import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { RunView } from '../../src/presentation/ipc/contract/index.ts';
import type { ConfigEditorView as ConfigView } from '../../src/feature/swarm-edit/types/index.ts';
import { copyTemplateRepo } from '../fixtures/template-repo.ts';
import { startRun, until, type Harness } from './harness.ts';

/** One step, one pipeline per runtime and model: the pool of a group follows its pipeline. */
export const POOLS_CONFIG = `swarm:
  max: 5
  specialists:
    claude-coder: { name: Клод, runtime: claude, model: sonnet }
    gemini-coder: { name: Джемини, runtime: opencode, model: google/gemini-2 }
    gpt-coder: { name: GPT, runtime: opencode, model: openai/gpt-5 }
    glm-coder: { name: GLM, runtime: opencode, model: zai/glm-5 }
    plain-coder: { name: Простой, runtime: opencode }
  pipelines:
    on-claude: { steps: [{ id: code, specialist: claude-coder }] }
    on-gemini: { steps: [{ id: code, specialist: gemini-coder }] }
    on-gpt: { steps: [{ id: code, specialist: gpt-coder }] }
    on-glm: { steps: [{ id: code, specialist: glm-coder }] }
    on-plain: { steps: [{ id: code, specialist: plain-coder }] }
`;

/** The split 2/2/1 of the example: Claude, Gemini and GPT together, GLM; the rest in `default_pool`. */
export const SPLIT_QUEUE = `{
  max: 5,
  pools: {
    claude: { max: 2, members: [claude] },
    mix: { max: 2, members: ["opencode:google/*", "opencode:openai/*"] },
    glm: { max: 1, members: ["opencode:zai/*"] }
  },
  default_pool: { max: 1 }
}`;

export function settingsFile(h: Harness): string {
  return join(h.environment.XDG_CONFIG_HOME!, 'aip', 'settings.yaml');
}

/** Writes `queue:` into the shared settings.yaml by hand, the way a person edits the file. */
export function writeQueue(h: Harness, queue: string): void {
  mkdirSync(dirname(settingsFile(h)), { recursive: true });
  writeFileSync(settingsFile(h), `queue: ${queue}\n`);
}

/** Changes `queue.max` through the settings API, as the panel does. */
export async function setQueueMax(h: Harness, max: number): Promise<void> {
  const view = (await h.call('config', { repository: h.repo })) as ConfigView;
  const result = (await h.call('config_setting', {
    repository: h.repo,
    path: 'queue.max',
    value: max,
    revision: view.settingsFiles.global.revision,
    level: 'global',
  })) as { ok: boolean };
  if (!result.ok) throw new Error(`queue.max was not written: ${JSON.stringify(result)}`);
}

/** A project of the daemon next to the harness repository with the same pipelines. */
export async function addProject(h: Harness, name: string, config = POOLS_CONFIG): Promise<string> {
  const path = join(dirname(h.repo), name);
  copyTemplateRepo(path, config, { 'lib.ts': 'export const value = 1;\n' });
  await h.call('repository_add', { path });
  return path;
}

/** A direct run of `pipeline` with a group per title. */
export async function direct(
  h: Harness,
  pipeline: string,
  titles: string[],
  repository = h.repo,
): Promise<string> {
  const created = await startRun(h, {
    repository,
    pipeline,
    groups: titles.map((title) => ({ title, task: `работа ${title}` })),
  });
  return created.runId;
}

type Row = RunView['groups'][number];

export async function rowsOf(h: Harness, runId: string): Promise<Row[]> {
  return (await h.status(runId)).groups;
}

export const statusesIn = (rows: Row[]): string[] => rows.map((row) => row.status);

/** Waits until the group is in the status; returns its row. */
export async function waitRow(
  h: Harness,
  runId: string,
  slug: string,
  status: string,
): Promise<Row> {
  let found: Row | undefined;
  await until(`${slug} of ${runId} is ${status}`, async () => {
    found = (await rowsOf(h, runId)).find((row) => row.slug === slug);
    return found?.status === status;
  });
  return found!;
}

/** The number of groups of the runs that work now. */
export async function workingIn(h: Harness, runIds: string[]): Promise<number> {
  let count = 0;
  for (const runId of runIds) {
    count += (await rowsOf(h, runId)).filter((row) => row.status === 'running').length;
  }
  return count;
}
