import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach } from 'vitest';

import type { RunCreated } from '../../src/protocol/index.ts';
import { POLL_MS, WORKFLOW_CONFIG, harness, startRun, until, type Harness } from './harness.ts';

export { until };

// Shared by the control test files; importing this module stops the daemon a test left running.
let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

export async function start(config?: string, environment?: NodeJS.ProcessEnv): Promise<Harness> {
  current = await harness(config, environment);
  return current;
}

export async function run(h: Harness, count = 1): Promise<string> {
  const groups = Array.from({ length: count }, (_, index) => ({
    title: `g${index + 1}`,
    task: `task ${index + 1}`,
  }));
  return ((await startRun(h, { repository: h.repo, workflow: 'feature', groups })) as RunCreated)
    .runId;
}

export function calls(h: Harness): { step: string; group: string; args: string[] }[] {
  return readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const SHORT_TIMEOUT = WORKFLOW_CONFIG.replace(
  'coder: { name: Кодировщик }',
  'coder: { name: Кодировщик, timeout: 1s }',
);
