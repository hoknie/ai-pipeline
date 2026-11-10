import { describe, expect, it } from 'vitest';

import { createOpencodeRuntime } from '../../../src/feature/agents/clients/opencode/index.ts';
import { findSpecialist } from '../../../src/feature/swarm-config/types/index.ts';
import type { LaunchContext } from '../../../src/feature/agents/types/index.ts';
import { config } from '../runs/helpers.ts';

const runtime = createOpencodeRuntime('/bin/opencode');
const base = findSpecialist(config(), 'coder')!;
const context: LaunchContext = {
  specialist: { ...base, model: 'MyProvider/team/GPT-Custom', variant: 'Deep' },
  input: {
    prompt: 'task',
    groupTitle: 'Group',
    stepId: 'code',
    specialistName: 'Coder',
    skills: [],
    previous: [],
    feedback: null,
    humanAnswer: null,
    decisions: [],
  },
  worktree: '/repo/worktree',
  attemptDirectory: '/tmp/attempt',
  workerCommand: ['node', 'aip'],
  sessionId: 'new-session',
  resumeSession: 'old-session',
  claudeEditMode: 'allowlist',
  claudeMcp: 'isolated',
  claudeSettings: 'isolated',
};

describe('OpenCode model argument', () => {
  it('passes the exact qualified model with its variant as one argument, and the session', () => {
    const launch = runtime.buildLaunch(context);
    const modelIndex = launch.args.indexOf('-m');
    expect(launch.args[modelIndex + 1]).toBe('MyProvider/team/GPT-Custom#Deep');
    expect(launch.args).not.toContain('--variant');
    expect(launch.args).toContain('old-session');
  });

  it('omits -m when the specialist leaves model selection to OpenCode', () => {
    const launch = runtime.buildLaunch({ ...context, specialist: { ...base, model: null } });
    expect(launch.args).not.toContain('-m');
  });

  it('passes a one-shot model unchanged', () => {
    const launch = runtime.buildOneShot({
      prompt: 'name',
      model: 'Other/team/GPT-Custom',
      directory: '/tmp/naming',
    });
    const modelIndex = launch.args.indexOf('-m');
    expect(launch.args[modelIndex + 1]).toBe('Other/team/GPT-Custom');
    expect(launch.args[modelIndex + 2]).toBe('name');
  });
});
