import { parseConfig } from '../../src/feature/swarm-config/services/index.ts';
import { type ResolvedConfig } from '../../src/feature/swarm-config/types/index.ts';
import {
  createRun,
  dispatch,
  findGroup,
  transition,
  type Attempt,
  type Effect,
  type HumanQuestion,
  type RunState,
  type Verdict,
} from '../../src/core/index.ts';

export const CONFIG_TEXT = `swarm:
  max: 5
  specialists:
    plan: { name: Планировщик, prompt: "План: %s" }
    coder: { name: Кодировщик, runtime: opencode, model: anthropic/sonnet }
    reviewer: { name: Ревьюер, permissions: read }
    qa: { name: Тестировщик }
  pipelines:
    feature:
      steps:
        - { id: plan, specialist: plan }
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 } }
        - { id: qa, specialist: qa }
`;

export function config(text = CONFIG_TEXT): ResolvedConfig {
  return parseConfig(text);
}

export function run(
  groups: number,
  options: {
    id?: string;
    now?: number;
    max?: number;
    split?: boolean;
    configText?: string;
    autoDeliver?: boolean;
    deliveryMode?: 'worktree' | 'commit' | 'branch';
    skip?: string[];
  } = {},
): RunState {
  const resolved = config(options.configText);
  if (options.max !== undefined) resolved.max = options.max;
  return createRun({
    id: options.id ?? 'run000000001',
    number: 1,
    repository: '/repo',
    pipeline: 'feature',
    baseCommit: 'abc',
    config: resolved,
    dirtyWarning: false,
    groups: Array.from({ length: groups }, (_, index) => ({
      title: `Группа ${index + 1}`,
      task: `задача ${index + 1}`,
    })),
    split: options.split ?? false,
    now: options.now ?? 1000,
    autoDeliver: options.autoDeliver,
    deliveryMode: options.deliveryMode,
    skip: options.skip,
  });
}

export function group(state: RunState, slug = 'gruppa-1') {
  const found = findGroup(state, slug);
  if (!found) throw new Error(`no group ${slug}`);
  return found;
}

export function runningAttempt(state: RunState, slug = 'gruppa-1'): Attempt {
  const attempt = group(state, slug).attempts.find((candidate) => candidate.status === 'running');
  if (!attempt) throw new Error(`no running attempt in ${slug}`);
  return attempt;
}

export function finish(
  state: RunState,
  verdict: Verdict,
  options: {
    slug?: string;
    feedback?: string;
    summary?: string;
    now?: number;
    questions?: HumanQuestion[];
    humanOnly?: boolean;
  } = {},
): Effect[] {
  const slug = options.slug ?? 'gruppa-1';
  const attempt = runningAttempt(state, slug);
  const now = options.now ?? 2000;
  transition(
    state,
    {
      kind: 'report',
      group: slug,
      seq: attempt.seq,
      report: {
        verdict,
        summary: options.summary ?? `${attempt.stepId} ${verdict}`,
        feedback:
          options.feedback ?? (verdict === 'done' || options.questions ? null : 'замечания'),
        ...(options.questions ? { questions: options.questions } : {}),
        ...(options.humanOnly ? { humanOnly: true } : {}),
      },
    },
    now,
  );
  return transition(
    state,
    {
      kind: 'attempt_exited',
      group: slug,
      seq: attempt.seq,
      exit: { sessionId: `session-${attempt.seq}`, usage: null, failure: null, outsideChanges: [] },
    },
    now,
  );
}

export function step(state: RunState, now = 1500): Effect[] {
  return dispatch([state], now);
}
