import type { HumanDecision, Suggestion, Usage } from '../../../../feature/agents/types/index.ts';
import type {
  GroupDelivery,
  GroupWait,
  HumanOnly,
  HumanQuestion,
} from '../../../../feature/runs/types/index.ts';
import type { DiffStat, RowStatus, ViewDecision } from './runs.ts';

export interface AttemptDecision {
  question: string;
  answer: string;
  by: HumanDecision['by'];
}

export interface AttemptView {
  seq: number;
  stepId: string;
  /** The human name of the step. */
  stepName: string;
  round: number;
  specialist: string;
  runtime: string;
  model: string | null;
  status: string;
  verdict: string | null;
  summary: string | null;
  feedback: string | null;
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

/** The documents of the OpenSpec change a group works on. */
export interface GroupSpecView {
  /** The directory name of the change, for example `add-export`. */
  change: string;
  /** The directory of the change from the repository root. */
  path: string;
  design: string | null;
  tasks: string | null;
}

export interface SpecCandidate {
  change: string;
  path: string;
}

/** Answer to `group_file_diff`: the diff of one file of a group, without the file headers. */
export interface FileDiffView {
  path: string;
  previousPath: string | null;
  binary: boolean;
  lines: string[];
  totalLines: number;
  truncated: boolean;
}
