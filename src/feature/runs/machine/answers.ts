import { AppError, rejected } from '../../../platform/errors/index.ts';
import {
  type PermissionsRefresh,
  type Usage,
  refreshPermissions,
} from '../../agents/types/index.ts';
import {
  type Group,
  type ProposedGroup,
  type Report,
  findGroup,
  runPipeline,
  validateReport,
} from '../types/index.ts';
import type { Ctx } from './events.ts';
import { groupOf, runningAttempt } from './steps.ts';
import { questionsText } from './texts.ts';

export function wrongStatus(group: Group, action: string, expected: string): AppError {
  return rejected(`group \`${group.slug}\` is ${group.status}; ${action} needs ${expected}`);
}

/** Takes the permissions of the current configuration into the snapshot of the run. */
export function refreshPermissionsOf(
  m: Ctx,
  group: Group,
  permissions: PermissionsRefresh | undefined,
): void {
  if (!permissions) return;
  const error = refreshPermissions(m.state.run.config, permissions);
  if (error !== null) group.warnings.push(`permissions not refreshed: ${error}`);
}

export function answerQuestion(
  m: Ctx,
  slug: string,
  answer: string,
  by: 'human' | 'autopilot' | 'observer',
  permissions?: PermissionsRefresh,
): void {
  if (answer.trim() === '') throw rejected('answer must not be empty');
  const group = groupOf(m, slug);
  if (group.status !== 'needs_human') throw wrongStatus(group, 'answer', 'needs_human');
  refreshPermissionsOf(m, group, permissions);
  const last = group.attempts.at(-1);
  const askedBy = group.pending?.askedBy;
  const asking =
    askedBy !== undefined
      ? group.attempts.find((candidate) => candidate.seq === askedBy)
      : last && last.stepIndex === group.pending?.stepIndex
        ? last
        : undefined;
  const stepId =
    asking?.stepId ??
    group.attempts.find((candidate) => candidate.stepIndex === group.pending?.stepIndex)?.stepId ??
    last?.stepId ??
    '';
  group.decisions.push({
    stepId,
    question: group.question ?? '',
    answer,
    by,
    ...(asking ? { attemptSeq: asking.seq } : {}),
  });
  group.status = 'queued';
  group.question = null;
  group.questions = null;
  if (group.pending) {
    group.pending.humanAnswer = answer;
    delete group.pending.askedBy;
    if (group.humanOnly === 'review') group.pending.reviewed = true;
  }
  group.humanOnly = null;
}

export function recordUsage(m: Ctx, updates: { group: string; seq: number; usage: Usage }[]): void {
  for (const update of updates) {
    const group = findGroup(m.state, update.group);
    const attempt = group ? runningAttempt(group, update.seq) : undefined;
    if (attempt) attempt.usage = update.usage;
  }
}

export function reportAttempt(m: Ctx, slug: string, seq: number, report: Report): void {
  const attempt = runningAttempt(groupOf(m, slug), seq);
  if (!attempt) throw rejected(`attempt ${seq} is not running`);
  if (attempt.reason?.kind === 'message') {
    throw rejected(`attempt ${seq} was interrupted by a message`);
  }
  const problem = validateReport(report);
  if (problem !== null) throw rejected(`invalid report: ${problem}`);
  attempt.report = {
    verdict: report.verdict,
    summary: report.summary,
    feedback: report.feedback?.trim()
      ? report.feedback
      : report.questions
        ? questionsText(report.questions)
        : null,
    ...(report.questions ? { questions: report.questions } : {}),
    ...(report.humanOnly ? { humanOnly: true } : {}),
  };
}

export function proposeSplit(m: Ctx, seq: number, groups: ProposedGroup[]): void {
  const split = m.state.split;
  const attempt = split ? runningAttempt(split, seq) : undefined;
  if (!split || !attempt) throw rejected(`attempt ${seq} is not a running split step`);
  const maxGroups = runPipeline(m.state.run).split?.maxGroups ?? 1;
  if (groups.length < 1 || groups.length > maxGroups) {
    throw rejected(`propose from 1 to ${maxGroups} groups, got ${groups.length}`);
  }
  const empty = groups.findIndex((group) => group.title.trim() === '' || group.task.trim() === '');
  if (empty !== -1) throw rejected(`group ${empty + 1} needs a non-empty title and task`);
  attempt.proposal = groups.map((group) => ({ title: group.title.trim(), task: group.task }));
}

export function messageAttempt(m: Ctx, slug: string, seq: number, text: string): void {
  const attempt = runningAttempt(groupOf(m, slug), seq);
  if (!attempt) throw rejected(`attempt ${seq} is not running`);
  if (attempt.runtime === 'command') {
    throw rejected(`attempt ${seq} is a command; it takes no messages`);
  }
  if (attempt.report !== null) throw rejected(`attempt ${seq} already reported`);
  if (attempt.reason !== null) {
    throw rejected(`attempt ${seq} is already being interrupted`);
  }
  attempt.reason = { kind: 'message', text, at: m.now };
  m.effects.push({ kind: 'stop_attempt', run: m.state.run.id, group: slug, seq });
}
