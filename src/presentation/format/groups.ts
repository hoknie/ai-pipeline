import { clockTime } from '../../feature/runs/types/index.ts';
import { type Style, plainStyle, statusBadge } from './style.ts';
import { formatUsage, humanMark, oneLine, seconds } from './table.ts';
import type {
  ApplyResult,
  DenialView,
  DiffTotals,
  FileStat,
  GroupView,
} from '../ipc/contract/index.ts';

export function formatDiff(diff: DiffTotals | null | undefined, style: Style = plainStyle): string {
  // A daemon older than the client sends no statistics.
  if (!diff) return '—';
  return `${diff.files} ${diff.files === 1 ? 'file' : 'files'} ${style.success(`+${diff.added}`)} ${style.danger(`−${diff.removed}`)}`;
}

function fileLine(file: FileStat, style: Style): string {
  return file.added === null
    ? `${file.path} (binary)`
    : `${file.path} ${style.success(`+${file.added}`)} ${style.danger(`−${file.removed ?? 0}`)}`;
}

/** ` (usage limit, until HH:MM)` for a group waiting for a usage limit to reset. */
export function limitNote(limitUntil: number | null): string {
  return limitUntil === null ? '' : ` (usage limit, until ${clockTime(limitUntil)})`;
}

export function formatGroup(group: GroupView, style: Style = plainStyle): string {
  const lines = [
    `Group ${style.accent(group.slug)} (${group.title}) · ${statusBadge(group.status, style)}${limitNote(group.limitUntil)} · run ${style.accent(group.runId)}`,
    `${style.muted('Ref:')} ${group.branch}`,
    `${style.muted('Worktree:')} ${group.worktree}`,
    `${style.muted('Usage:')} ${formatUsage(group.usage)}`,
    `${style.muted('Task:')} ${group.task}`,
  ];
  if (group.question) {
    lines.push(style.warning(`Question${humanMark(group.humanOnly)}: ${group.question}`));
  }
  for (const decision of group.decisions ?? []) {
    const who = decision.by;
    lines.push(
      `${style.muted(`Answer (${who}, ${decision.stepId}):`)} ${decision.question.split('\n')[0]} → ${decision.answer}`,
    );
  }
  if (group.reason) lines.push(style.danger(`Reason: ${group.reason}`));
  for (const warning of group.warnings) lines.push(style.warning(`Warning: ${warning}`));
  for (const attempt of group.attempts) {
    if (attempt.outsideChanges.length === 0) continue;
    lines.push(
      style.warning(
        `Warning: files in the working copy changed during step ${attempt.stepName}: ${attempt.outsideChanges.join(', ')}`,
      ),
    );
  }
  if (group.permissionHints.length > 0) {
    const patterns = group.permissionHints.map((pattern) => `'${pattern}'`).join(', ');
    lines.push(
      `Permission hints: add to allow_commands: ${patterns} (a retry or an answer picks them up)`,
    );
  }
  if (group.conflictFiles.length > 0)
    lines.push(style.danger(`Conflicts: ${group.conflictFiles.join(', ')}`));
  lines.push(`${style.muted('Delivery:')} ${describeDelivery(group.delivery, style)}`);
  if (group.diff) {
    lines.push(
      `${style.muted('Changes:')} ${formatDiff({ ...group.diff, files: group.diff.files.length }, style)}`,
    );
    for (const file of group.diff.files) lines.push(`  ${fileLine(file, style)}`);
  }
  lines.push('', style.muted('Attempts:'));
  for (const attempt of group.attempts) {
    lines.push(
      `  #${attempt.seq} ${attempt.stepName} r${attempt.round} · ${attempt.specialist} (${attempt.runtime}${attempt.model ? ` ${attempt.model}` : ''}) · ${statusBadge(attempt.status, style)}${attempt.verdict ? ` ${attempt.verdict}` : ''} · ${seconds(attempt.durationMs)} · ${formatUsage(attempt.usage)}`,
    );
    if (attempt.summary) lines.push(`     summary: ${attempt.summary}`);
    if (attempt.feedback) lines.push(`     feedback: ${attempt.feedback}`);
    if (attempt.decision) {
      lines.push(`     answer (${attempt.decision.by}): ${attempt.decision.answer}`);
    }
    if (attempt.reason) lines.push(style.danger(`     reason: ${attempt.reason}`));
    for (const denial of attempt.denials) lines.push(`     denied: ${denialLine(denial)}`);
  }
  if (group.attempts.length === 0) lines.push('  none yet');
  if (group.log)
    lines.push(
      '',
      style.muted(`Log of attempt #${group.log.seq}:`),
      ...group.log.lines.map((line) => `  ${line}`),
    );
  return lines.join('\n');
}

function denialLine(denial: DenialView): string {
  const call = denial.command === null ? denial.tool : `${denial.tool} ${oneLine(denial.command)}`;
  const patterns = denial.suggestions.map((suggestion) =>
    suggestion.pattern === null ? 'no pattern allows it' : suggestion.pattern,
  );
  return patterns.length > 0 ? `${call} → ${patterns.join(', ')}` : call;
}

function describeDelivery(delivery: GroupView['delivery'], style: Style = plainStyle): string {
  const files = delivery.files.length > 0 ? ` (${delivery.files.join(', ')})` : '';
  const conflicts =
    delivery.conflicts.length > 0 ? `; conflicts: ${delivery.conflicts.join(', ')}` : '';
  const userEdits =
    delivery.userEdits.length > 0
      ? `; committed with your uncommitted edits: ${delivery.userEdits.join(', ')}`
      : '';
  if (delivery.state === 'apply_failed')
    return `${statusBadge('apply_failed', style)}: ${delivery.reason ?? ''}${files}`;
  const manual = delivery.manual ? ' (manually)' : '';
  return `${statusBadge(delivery.state, style)}${manual}${files}${conflicts}${userEdits}`;
}

export function formatApply(result: ApplyResult, style: Style = plainStyle): string {
  if (result.pending)
    return `Run ${style.accent(result.runId)}: the commit message is being written; delivery follows.`;
  return result.groups
    .map((group) => `${style.accent(group.slug)}: ${describeDelivery(group.delivery, style)}`)
    .join('\n');
}
