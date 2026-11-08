import { join } from 'node:path';
import type { LaunchContext } from '../../../src/feature/agents/types/index.ts';
import { config } from '../runs/helpers.ts';

export function agyContext(root = '/state', overrides: Partial<LaunchContext> = {}): LaunchContext {
  return {
    specialist: {
      ...config().specialists.find((item) => item.slug === 'coder')!,
      runtime: 'agy',
      model: null,
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
    worktree: join(root, 'worktree'),
    attemptDirectory: join(root, 'attempt'),
    workerCommand: [process.execPath, '/aip/main.js', 'mcp', '--worker', 'secret', '--split'],
    sessionId: 'fresh-id',
    resumeSession: null,
    claudeMcp: 'isolated',
    claudeEditMode: 'allowlist',
    claudeSettings: 'isolated',
    ...overrides,
  };
}
