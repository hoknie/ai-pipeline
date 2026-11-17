import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LaunchContext } from '../../../src/feature/agents/types/index.ts';
import type { Runtime } from '../../../src/feature/swarm-config/types/index.ts';
import { config } from '../runs/helpers.ts';

/** A launch context of a CLI with a private conversation state under a fresh temporary folder. */
export function conversationContext(
  runtime: Runtime,
  overrides: Partial<LaunchContext> = {},
  root = mkdtempSync(join(tmpdir(), 'aip-conv-')),
): LaunchContext & { root: string } {
  const worktree = join(root, 'worktree');
  mkdirSync(worktree, { recursive: true });
  return {
    root,
    specialist: {
      ...config().specialists.find((item) => item.slug === 'coder')!,
      runtime,
      model: 'team-model',
      permissions: 'edit',
      allowCommands: ['npm test*'],
    },
    input: {
      prompt: 'Implement login',
      groupTitle: 'Login',
      stepId: 'code',
      specialistName: 'Coder',
      skills: [],
      previous: [],
      feedback: null,
      humanAnswer: null,
      decisions: [],
    },
    worktree,
    environment: {},
    attemptDirectory: join(root, 'logs', 'run', 'g1', '1'),
    conversationDirectory: join(root, 'logs', 'run', 'g1', 'conversations', `code-g1-${runtime}`),
    generation: 1,
    workerCommand: [
      process.execPath,
      '/aip/main.js',
      'mcp',
      '--worker',
      'secret-token',
      '--socket',
      '/s',
    ],
    sessionId: 'attempt-1',
    resumeSession: null,
    claudeMcp: 'isolated',
    claudeEditMode: 'allowlist',
    claudeSettings: 'isolated',
    ...overrides,
  };
}

export function link(target: string, path: string): void {
  symlinkSync(target, path);
}
