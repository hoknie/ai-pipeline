import type { HumanDecision, Suggestion, Usage } from '../../../../feature/agents/types/index.ts';
import type {
  GroupDelivery,
  GroupWait,
  HumanOnly,
  HumanQuestion,
} from '../../../../feature/runs/types/index.ts';
import type { DiffStat, RowStatus, ViewDecision } from './runs.ts';
import type { Report } from '../../../../feature/runs/types/index.ts';

export interface AttemptDecision {
  question: string;
  answer: string;
  by: HumanDecision['by'];
}

export interface AttemptView {
  review?: Report['review'];
  implementation?: Report['implementation'];
  strategy?: Report['strategy'];
  seq: number;
  stepId: string;
  /** The human name of the step. */
  stepName: string;
  round: number;
  specialist: string;
  runtime: string;
  model: string | null;
  /** Provider of the chain item the attempt ran on, when it has one. */
  provider?: string;
  /**
   * The provider the run asked for, on attempts recorded before the run provider limited every
   * chain mode; new attempts have no such field.
   */
  requestedProvider?: string;
  /** The name of `provider` in the configuration of the run, when it has one. */
  providerName?: string;
  /**
   * The name of `requestedProvider` in the configuration of the run, when it has one; like
   * `requestedProvider`, only on attempts recorded before the change.
   */
  requestedProviderName?: string;
  status: string;
  verdict: string | null;
  summary: string | null;
  feedback: string | null;
  /** `reply`: the commit message author sent no report, `summary` is the text of its answer. */
  reportSource?: 'reply';
  /** The accepted answer to the question this attempt asked (verdict needs_human), if any. */
  decision: AttemptDecision | null;
  reason: string | null;
  startedAt: number;
  durationMs: number;
  usage: Usage | null;
  /** Tool calls the agent CLI refused, with allow_commands patterns that would let them run. */
  denials: DenialView[];
  /** Files the attempt changed outside its worktree. */
  outsideChanges: string[];
  /** The message the human sent to the specialist before this attempt continued its session. */
  message: { text: string; at: number } | null;
  /** A human message or a pause is stopping this running attempt. */
  interrupting: boolean;
}

export interface DenialView {
  tool: string;
  command: string | null;
  /** Parts of the command that no current allow_commands pattern covers. */
  suggestions: Suggestion[];
}

export interface GroupView {
  runId: string;
  slug: string;
  title: string;
  task: string;
  status: RowStatus;
  /** Why the group is `waiting`; null for other statuses. */
  wait: GroupWait | null;
  branch: string;
  worktree: string;
  question: string | null;
  questions: HumanQuestion[] | null;
  humanOnly: HumanOnly | null;
  /** Accepted answers to the questions of the group, a person's and the autopilot's, oldest first. */
  decisions: ViewDecision[];
  reason: string | null;
  /** The group waits in `queued` until its runtime's usage limit resets (ms); null otherwise. */
  limitUntil: number | null;
  warnings: string[];
  conflictFiles: string[];
  delivery: GroupDelivery;
  usage: Usage | null;
  diff: DiffStat | null;
  attempts: AttemptView[];
  /** Patterns to add to allow_commands for the refused commands of the group, each once. */
  permissionHints: string[];
  log: { seq: number; lines: string[] } | null;
}

export type {
  FileDiffView,
  GroupSpecView,
  SpecCandidate,
} from '../../../../feature/delivery/types/index.ts';
