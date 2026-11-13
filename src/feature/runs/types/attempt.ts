import type { Denial, StepInput, Usage, Verdict } from '../../agents/types/index.ts';
import type { ReasoningEffort } from '../../swarm-config/types/index.ts';
import {
  type AttemptRuntime,
  type AttemptStatus,
  FEEDBACK_LIMIT,
  OPTIONS_LIMIT,
  OPTION_LIMIT,
  QUESTIONS_LIMIT,
  QUESTION_TEXT_LIMIT,
  RECOMMENDATION_LIMIT,
  SUMMARY_LIMIT,
} from './constants.ts';

/** One question of a specialist to the human, with optional options and a recommended answer. */
export interface HumanQuestion {
  text: string;
  options?: string[] | null;
  recommendation?: string | null;
}

export interface Report {
  verdict: Verdict;
  summary: string;
  feedback: string | null;
  questions?: HumanQuestion[] | null;
  /** With `needs_human`: only a person can answer; the queue autopilot leaves it alone. */
  humanOnly?: boolean;
}

export type FailReason =
  | { kind: 'timeout' }
  | { kind: 'no_report' }
  | { kind: 'interrupted' }
  /** A command action ended with a non-zero exit code. */
  | { kind: 'exit_code'; code: number }
  | { kind: 'no_groups' }
  | { kind: 'runtime_not_found'; runtime: string }
  /** The runtime is switched off in the settings. */
  | { kind: 'runtime_disabled'; runtime: string }
  | { kind: 'spawn'; message: string }
  | { kind: 'git'; message: string }
  /** The step was skipped while its attempt ran. */
  | { kind: 'skipped' }
  /** The runtime ran out of its usage limit; `resetsAt`: when it resets (ms), null when unknown. */
  | { kind: 'usage_limit'; resetsAt: number | null }
  /** The network was down or the API of the agent was unreachable; the step goes on after a pause. */
  | { kind: 'network'; problem: string }
  /** A human message interrupted the attempt; the step continues in the same session. */
  | { kind: 'message'; text: string; at: number }
  /** A pause of the run stopped the attempt; the step continues in the same session. */
  | { kind: 'paused'; at: number };

/** Local `HH:MM` of a moment. */
export function clockTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** A failure of the observer's attempt that gives the repair back: nobody's fault, the incident waits. */
export function refundsRepair(reason: FailReason): boolean {
  return ['usage_limit', 'runtime_disabled', 'runtime_not_found'].includes(reason.kind);
}

export function describeFailReason(reason: FailReason): string {
  switch (reason.kind) {
    case 'timeout':
      return 'timeout';
    case 'no_report':
      return 'no report';
    case 'interrupted':
      return 'interrupted';
    case 'exit_code':
      return `exit code ${reason.code}`;
    case 'no_groups':
      return 'no groups';
    case 'runtime_not_found':
      return `runtime not found: ${reason.runtime}`;
    case 'runtime_disabled':
      return `runtime disabled: ${reason.runtime}`;
    case 'spawn':
      return `spawn error: ${reason.message}`;
    case 'git':
      return `git: ${reason.message}`;
    case 'skipped':
      return 'step skipped';
    case 'message':
      return 'interrupted by a message';
    case 'paused':
      return 'interrupted by a pause';
    case 'network':
      return `network: ${reason.problem}`;
    case 'usage_limit':
      return reason.resetsAt === null
        ? 'usage limit'
        : `usage limit, resets ${clockTime(reason.resetsAt)}`;
  }
}

export function validateReport(report: Report): string | null {
  if (report.summary.trim() === '') return 'summary must not be empty';
  if ([...report.summary].length > SUMMARY_LIMIT) {
    return `summary must be at most ${SUMMARY_LIMIT} characters`;
  }
  const feedback = report.feedback?.trim() ? report.feedback : null;
  const questions = report.questions ?? null;
  if (report.humanOnly && report.verdict !== 'needs_human') {
    return 'human_only is allowed only when verdict is needs_human';
  }
  if (questions !== null) {
    if (report.verdict !== 'needs_human') {
      return 'questions are allowed only when verdict is needs_human';
    }
    const problem = validateQuestions(questions);
    if (problem !== null) return problem;
  }
  if (feedback === null && questions === null && report.verdict !== 'done') {
    return `feedback is required when verdict is ${report.verdict}`;
  }
  if (feedback !== null && [...feedback].length > FEEDBACK_LIMIT) {
    return `feedback must be at most ${FEEDBACK_LIMIT} characters`;
  }
  return null;
}

function validateQuestions(questions: HumanQuestion[]): string | null {
  if (questions.length < 1 || questions.length > QUESTIONS_LIMIT) {
    return `questions must contain 1 to ${QUESTIONS_LIMIT} items`;
  }
  for (const [index, question] of questions.entries()) {
    const name = `questions[${index}]`;
    if (question.text.trim() === '') return `${name}.text must not be empty`;
    if ([...question.text].length > QUESTION_TEXT_LIMIT) {
      return `${name}.text must be at most ${QUESTION_TEXT_LIMIT} characters`;
    }
    const options = question.options ?? null;
    if (options !== null) {
      if (options.length < 1 || options.length > OPTIONS_LIMIT) {
        return `${name}.options must contain 1 to ${OPTIONS_LIMIT} items`;
      }
      for (const option of options) {
        if (option.trim() === '') return `${name}.options must not contain empty strings`;
        if ([...option].length > OPTION_LIMIT) {
          return `${name}.options items must be at most ${OPTION_LIMIT} characters`;
        }
      }
    }
    const recommendation = question.recommendation ?? null;
    if (recommendation !== null) {
      if (recommendation.trim() === '') return `${name}.recommendation must not be empty`;
      if ([...recommendation].length > RECOMMENDATION_LIMIT) {
        return `${name}.recommendation must be at most ${RECOMMENDATION_LIMIT} characters`;
      }
    }
  }
  return null;
}

export interface ProposedGroup {
  title: string;
  task: string;
}

export interface Attempt {
  seq: number;
  stepId: string;
  stepIndex: number;
  round: number;
  specialist: string;
  runtime: AttemptRuntime;
  model: string | null;
  variant?: string;
  reasoningEffort?: ReasoningEffort;
  chainIndex?: number | null;
  status: AttemptStatus;
  input: StepInput;
  resumeSession: string | null;
  sessionId: string | null;
  report: Report | null;
  reason: FailReason | null;
  startedAt: number;
  finishedAt: number | null;
  usage: Usage | null;
  proposal: ProposedGroup[] | null;
  /** Tool calls the agent CLI refused during the attempt. */
  denials: Denial[];
  /** Files the attempt changed outside its worktree. */
  outsideChanges: string[];
}

export function attemptVerdict(attempt: Attempt): Verdict | null {
  return attempt.status === 'finished' ? (attempt.report?.verdict ?? null) : null;
}

/** A running agent (or a process that was one) whose descendants and process group are background. */
export interface AgentRoot {
  pid: number;
  run: string;
  /** Null for the naming of a run, which belongs to no group. */
  group: string | null;
  seq: number | null;
}
