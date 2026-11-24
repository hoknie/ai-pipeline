import { describe, expect, it } from 'vitest';

import { transition } from '../../../src/feature/runs/machine/index.ts';
import { finish, group, run, runningAttempt, step } from './helpers.ts';

const CODEX = `swarm:
  max: 5
  specialists:
    coder: { name: Coder, runtime: codex }
    other: { name: Other, runtime: opencode, model: p/m }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: code2, specialist: coder }
        - { id: plain, specialist: other }
`;

const CHAIN = `swarm:
  max: 5
  specialists:
    coder: { name: Coder, runtime_chain: pair }
  chains:
    pair:
      name: Pair
      mode: on_error
      runtimes:
        - { runtime: codex }
        - { runtime: copilot, model: backup }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;

const attempts = (state: ReturnType<typeof run>) => group(state).attempts;

describe('the generation of a conversation', () => {
  it('opens a generation equal to seq for a CLI with its own history, and none for the others', () => {
    const state = run(1, { configText: CODEX });
    step(state);
    expect(runningAttempt(state)).toMatchObject({ runtime: 'codex', seq: 1, generation: 1 });
    finish(state, 'done');
    step(state);
    expect(runningAttempt(state)).toMatchObject({ stepId: 'code2', seq: 2, generation: 2 });
    finish(state, 'done');
    step(state);
    expect(runningAttempt(state)).toMatchObject({ runtime: 'opencode', generation: null });
  });

  it('inherits the generation and the exact session on a resume on the same runtime', () => {
    const state = run(1, { configText: CODEX });
    step(state);
    finish(state, 'needs_human', { feedback: 'which?' });
    transition(state, { kind: 'answer', group: 'group-1', answer: 'this' }, 2500);
    step(state);
    expect(attempts(state)[1]).toMatchObject({
      seq: 2,
      generation: 1,
      resumeSession: 'session-1',
      stepId: 'code',
    });
  });

  it('never shares a generation between two steps of one specialist', () => {
    const state = run(1, { configText: CODEX });
    step(state);
    finish(state, 'done');
    step(state);
    const [first, second] = attempts(state);
    expect(first?.generation).not.toBe(second?.generation);
    expect(second?.resumeSession).toBeNull();
  });

  it('opens a new generation and no session for a retry without a resume', () => {
    const state = run(1, { configText: CODEX });
    step(state);
    finish(state, 'needs_human', { feedback: 'which?' });
    group(state).pending = { stepIndex: 0, feedback: null, humanAnswer: null, resume: false };
    group(state).status = 'queued';
    step(state);
    expect(attempts(state)[1]).toMatchObject({ seq: 2, generation: 2, resumeSession: null });
  });

  it('does not carry the id of a CLI over to another runtime of a chain', () => {
    const state = run(1, { configText: CHAIN });
    const fail = (seq: number, now: number) =>
      transition(
        state,
        {
          kind: 'attempt_exited',
          group: 'group-1',
          seq,
          exit: {
            sessionId: `thread-${seq}`,
            usage: null,
            failure: { kind: 'no_report' },
            outsideChanges: [],
          },
        },
        now,
      );
    step(state);
    expect(runningAttempt(state)).toMatchObject({ runtime: 'codex', generation: 1 });
    fail(1, 2000);
    // the chain moves on to Copilot: the id of Codex is not Copilot's, a new generation, no session
    step(state, 3000);
    expect(attempts(state)[1]).toMatchObject({
      runtime: 'copilot',
      generation: 2,
      resumeSession: null,
    });
  });
});

const PROVIDERS = `swarm:
  max: 5
  providers:
    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: opencode }] }
    zai: { name: Z.ai, access: [{ kind: cli, runtime: opencode, model_prefix: zai }] }
    openai: { name: OpenAI, access: [{ kind: cli, runtime: opencode, model_prefix: openai }] }
  chains:
    pair:
      name: Pair
      mode: on_error
      runtimes:
        - { provider: anthropic, runtime: opencode, model: anthropic/sonnet }
        - { provider: zai, runtime: opencode, model: zai/glm-5.3 }
        - { provider: openai, runtime: opencode, model: openai/gpt-6.1-sol }
  specialists:
    coder: { name: Coder, runtime_chain: pair }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;

describe('a session never crosses a provider', () => {
  it('keeps the session of a resume on the same provider', () => {
    const state = run(1, { configText: PROVIDERS, provider: 'zai' });
    step(state);
    expect(runningAttempt(state)).toMatchObject({ runtime: 'opencode', provider: 'zai' });
    finish(state, 'needs_human', { feedback: 'which?' });
    transition(state, { kind: 'answer', group: 'group-1', answer: 'this' }, 2500);
    step(state);
    expect(attempts(state)[1]).toMatchObject({
      provider: 'zai',
      resumeSession: 'session-1',
    });
  });

  it('opens a new session when the step continues on another provider', () => {
    const state = run(1, { configText: PROVIDERS, provider: 'zai' });
    step(state);
    finish(state, 'needs_human', { feedback: 'which?' });
    transition(state, { kind: 'answer', group: 'group-1', answer: 'this' }, 2500);
    expect(group(state).pending?.resume).toBe(true);
    state.run.provider = 'openai';
    step(state);
    expect(attempts(state)[1]).toMatchObject({
      provider: 'openai',
      resumeSession: null,
      sessionId: null,
    });
  });
});
