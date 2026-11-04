import { clockTime, type GroupWait, type Usage } from '../core/index.ts';

import { plainStyle, statusBadge, visibleWidth, type Style } from './style.ts';

import type {
  ApplyResult,
  DenialView,
  DiffTotals,
  FileStat,
  GroupView,
  QueueView,
  RepositoryView,
  RunCreated,
  RunQueued,
  RunView,
  TagView,
} from './views.ts';

function seconds(milliseconds: number): string {
  const total = Math.round(milliseconds / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatUsage(usage: Usage | null): string {
  if (!usage) return '—';
  const tokens = `${usage.inputTokens} in / ${usage.outputTokens} out`;
  return usage.costUsd === null ? tokens : `${tokens} · $${usage.costUsd.toFixed(4)}`;
}

function padVisible(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

/** Columns aligned by visible width; the first row is the header, muted. */
export function table(rows: string[][], style: Style = plainStyle): string {
  const widths =
    rows[0]?.map((_, column) => Math.max(...rows.map((row) => visibleWidth(row[column] ?? '')))) ??
    [];
  const shown = rows.map((row, index) =>
    index === 0 ? row.map((cell) => style.muted(cell)) : row,
  );
  return shown
    .map((row) =>
      row
        .map((cell, column) => padVisible(cell, widths[column] ?? 0))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

/** `#7`: how a task number is shown. */
export function taskNumber(number: number): string {
  return `#${number}`;
}

export function formatRunCreated(created: RunCreated, style: Style = plainStyle): string {
  const lines = [
    `Run ${taskNumber(created.number)} ${style.accent(created.runId)} started (${created.branch}).`,
  ];
  if (created.split) lines.push('The task is being split into groups first (group `_split`).');
  else
    lines.push(
      `Groups: ${created.groups.map((group) => `${group.slug} (${group.title})`).join(', ')}`,
    );
  for (const warning of created.warnings) lines.push(style.warning(`Warning: ${warning}`));
  return lines.join('\n');
}

export function formatRunQueued(result: RunQueued, style: Style = plainStyle): string {
  if (result.run) return formatRunCreated(result.run, style);
  const position = result.queue.items.find((item) => item.id === result.item)?.position ?? 0;
  const { status, parallel, runs } = result.queue;
  return `Task ${taskNumber(result.number)} ${result.item} queued at position ${position} (queue ${status}, ${runs.length} of ${parallel} places taken).`;
}

/** Local date and time of the moment, `YYYY-MM-DD HH:MM`. */
export function addedAt(milliseconds: number): string {
  const date = new Date(milliseconds);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

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

/** Labels `#name` separated by spaces; empty without tags. */
export function formatTagLabels(
  tags: readonly TagView[] | undefined,
  style: Style = plainStyle,
): string {
  return (tags ?? [])
    .map((tag) => style.argument(tag.task ? `#${tag.task.number}:${tag.name}` : `#${tag.name}`))
    .join(' ');
}

/** Keeps the runs that have at least one of the tags; names compare ignoring case. */
export function filterByTags(runs: readonly RunView[], names: readonly string[]): RunView[] {
  const wanted = new Set(names.map((name) => name.trim().toLocaleLowerCase('und')));
  return runs.filter((run) =>
    (run.tags ?? []).some((tag) => wanted.has(tag.name.toLocaleLowerCase('und'))),
  );
}

export function formatTagList(tags: readonly TagView[], style: Style = plainStyle): string {
  if (tags.length === 0) return 'No tags yet.';
  return table(
    [
      ['NAME', 'COLOR', 'TASK'],
      ...tags.map((tag) => [
        style.argument(tag.name),
        tag.color,
        tag.task ? `#${tag.task.number}` : '—',
      ]),
    ],
    style,
  );
}

function withTags(text: string, tags: readonly TagView[] | undefined, style: Style): string {
  const labels = formatTagLabels(tags, style);
  return labels === '' ? text : `${text} ${labels}`;
}

function shortTitle(title: string | undefined): string {
  if (!title) return '—';
  return title.length > 48 ? `${title.slice(0, 47)}…` : title;
}

export function formatRunList(runs: RunView[], style: Style = plainStyle): string {
  if (runs.length === 0) return 'No runs yet.';
  return table(
    [
      ['#', 'RUN', 'STATE', 'WORKFLOW', 'TITLE', 'GROUPS', 'CHANGES', 'USAGE', 'REPOSITORY'],
      ...runs.map((run) => [
        taskNumber(run.number),
        style.accent(run.id),
        statusBadge(run.state, style),
        run.workflow,
        withTags(shortTitle(run.title), run.tags, style),
        [
          run.split && run.split.status !== 'done'
            ? `split ${run.split.status}`
            : run.counts || '—',
          deliveryText(run),
        ]
          .filter(Boolean)
          .join(' · '),
        formatDiff(run.diff, style),
        formatUsage(run.usage),
        run.repository,
      ]),
    ],
    style,
  );
}

export function formatRun(run: RunView, now: number, style: Style = plainStyle): string {
  const header = [
    `Run ${taskNumber(run.number)} ${style.accent(run.id)} · ${run.workflow} · ${statusBadge(run.state, style)} · ${run.branch}`,
    ...(run.title
      ? [`${style.muted('Title:')} ${run.title}${run.name ? ` (${run.name})` : ''}`]
      : []),
    `${style.muted('Repository:')} ${run.repository}`,
    ...(run.tags && run.tags.length > 0
      ? [`${style.muted('Tags:')} ${formatTagLabels(run.tags, style)}`]
      : []),
    ...(run.steps.some((step) => step.skipped)
      ? [
          `${style.muted('Skipped steps:')} ${run.steps
            .filter((step) => step.skipped)
            .map((step) =>
              step.name.endsWith(` (${step.id})`) ? step.name : `${step.name} (${step.id})`,
            )
            .join(', ')}`,
        ]
      : []),
    `${style.muted('Groups:')} ${run.counts || '—'} (${run.total}) · usage ${formatUsage(run.usage)} · started ${seconds(now - run.createdAt)} ago`,
  ];
  const delivery = deliveryText(run);
  if (delivery) header.push(`${style.muted('Delivery:')} ${delivery}`);
  if (run.diff) header.push(`${style.muted('Changes:')} ${formatDiff(run.diff, style)}`);
  if (run.resolver) {
    const { status, round, rounds, conflicts, reason } = run.resolver;
    const details = [`round ${round}/${rounds}`];
    if (conflicts.length > 0) details.push(`conflicts: ${conflicts.join(', ')}`);
    if (reason) details.push(style.danger(reason));
    header.push(
      `${style.muted('Resolver:')} ${statusBadge(status, style)} (${details.join('; ')})`,
    );
  }
  if (!run.autoDeliver)
    header.push('Mode: manual delivery (merged groups wait for `aip run apply`)');
  if (run.dirtyWarning)
    header.push(style.warning('Warning: uncommitted changes were not included in this run.'));
  const system = systemLine(run, style);
  if (system) header.push(system);
  const asked = run.system.find((step) => step.question);
  if (asked?.question) header.push(style.warning(`  question: ${asked.question}`));
  if (run.groups.length === 0) return header.join('\n');
  const rows = table(
    [
      ['GROUP', 'STATUS', 'STEP', 'ROUND', 'TIME', 'CHANGES', 'DELIVERY', 'NOTE'],
      ...run.groups.map((group) => [
        group.slug,
        `${statusBadge(group.status, style)}${group.wait ? '' : limitNote(group.limitUntil)}`,
        group.stepName ?? group.step ?? '—',
        group.round === null ? '—' : String(group.round),
        seconds(group.durationMs),
        formatDiff(group.diff, style),
        group.status === 'merged' ? statusBadge(group.delivery, style) : '—',
        [
          group.question
            ? style.warning(`question: ${group.question.split('\n')[0]}`)
            : group.reason
              ? style.danger(group.reason)
              : '',
          waitNote(group.wait),
          group.warnings ? `${group.warnings} warning(s)` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      ]),
    ],
    style,
  );
  return `${header.join('\n')}\n\n${rows}`;
}

/** What a waiting group waits for, for the NOTE column. */
export function waitNote(wait: GroupWait | null | undefined): string {
  if (!wait) return '';
  if (wait.reason === 'limit')
    return `waiting for ${wait.runtime} usage limit, until ${clockTime(wait.until)}`;
  if (wait.reason === 'specialist') return `waiting for ${wait.specialist}`;
  return `waiting for a free place (swarm.max ${wait.max})`;
}

const SYSTEM_NAMES = { split: 'split', message: 'message', resolve: 'resolver' } as const;

/** `System:` line: split, commit message, resolver and delivery in this order; null when none. */
function systemLine(run: RunView, style: Style): string | null {
  const parts = (run.system ?? []).map((step) => {
    const detail = step.reason ? style.danger(step.reason) : waitNote(step.wait);
    return `${SYSTEM_NAMES[step.kind]} ${statusBadge(step.status, style)}${detail ? ` (${detail})` : ''}`;
  });
  const stage = run.deliveryStage;
  if (stage) {
    const detail =
      stage.status === 'apply_failed' && stage.reason
        ? style.danger(stage.reason.split('\n')[0] ?? '')
        : '';
    parts.push(`delivery ${statusBadge(stage.status, style)}${detail ? ` (${detail})` : ''}`);
  }
  return parts.length === 0 ? null : `${style.muted('System:')} ${parts.join(' · ')}`;
}

/** ` (usage limit, until HH:MM)` for a group waiting for a usage limit to reset. */
function limitNote(limitUntil: number | null): string {
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
  if (group.question) lines.push(style.warning(`Question: ${group.question}`));
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

function oneLine(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ⏎ ');
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

function deliveryText(run: RunView): string {
  const { applied, merged, failed, inProgress } = run.delivery;
  if (merged === 0) return '';
  const parts = [`applied ${applied}/${merged}`];
  if (failed > 0) parts.push(`apply_failed ${failed}`);
  if (inProgress) parts.push('delivering');
  return parts.join(' · ');
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
  return `${statusBadge(delivery.state, style)}${files}${conflicts}${userEdits}`;
}

export function formatApply(result: ApplyResult, style: Style = plainStyle): string {
  if (result.pending)
    return `Run ${style.accent(result.runId)}: the commit message is being written; delivery follows.`;
  return result.groups
    .map((group) => `${style.accent(group.slug)}: ${describeDelivery(group.delivery, style)}`)
    .join('\n');
}

function firstLine(text: string): string {
  const line = text.split('\n').find((part) => part.trim() !== '') ?? '';
  return line.trim().length > 80 ? `${line.trim().slice(0, 79)}…` : line.trim();
}

function stopReason(view: QueueView): string | null {
  const stop = view.stop;
  if (!stop) return null;
  if (stop.kind === 'item') return `item ${stop.item}: ${stop.error}`;
  if (stop.kind === 'limit') {
    const resumes = stop.autoResume ? ', resumes automatically' : '';
    return `usage limit of ${stop.runtime} in ${stop.run}, resets ${clockTime(stop.resetsAt)}${resumes}`;
  }
  const where = stop.group ? `run ${stop.run}, group ${stop.group}` : `run ${stop.run}`;
  return `${where}: ${stop.reason}`;
}

function queueRunLines(runs: QueueView['runs'], style: Style): string[] {
  const lines: string[] = [];
  for (const run of runs) {
    const progress =
      run.groups.total === 0
        ? 'splitting'
        : `${run.groups.done}/${run.groups.total} groups · steps ${run.steps.done}/${run.steps.total}`;
    const delivering = `${run.delivering ? ' · delivering' : ''}${run.priority ? ' · priority' : ''}`;
    lines.push(
      `  ${taskNumber(run.number)} ${style.accent(run.id)}  ${statusBadge(run.state, style)}  ${run.workflow}  ${withTags(run.title, run.tags, style)}  ${progress}${delivering}`,
    );
    for (const active of run.active) {
      lines.push(
        `    ${active.group}${(active.stepName ?? active.step) ? `: ${active.stepName ?? active.step}` : ''}`,
      );
    }
    for (const held of run.waiting ?? []) {
      lines.push(
        `    ${held.group}${(held.stepName ?? held.step) ? `: ${held.stepName ?? held.step}` : ''} (${waitNote(held.wait)})`,
      );
    }
    if (run.problem) {
      lines.push(
        style.danger(
          `    problem: ${run.problem.reason}${run.problem.group ? ` in ${run.problem.group}` : ''}`,
        ),
      );
    }
  }
  return lines;
}

export function formatQueue(view: QueueView, style: Style = plainStyle): string {
  const lines = [
    `${style.muted('Queue:')} ${statusBadge(view.status, style)}, parallel ${view.parallel} (${view.runs.length} of ${view.parallel} places taken), autopilot ${view.autopilot ? 'on' : 'off'}, skip failed ${view.skipFailed ? 'on' : 'off'}${view.onLimit === 'stop' ? ', on limit stop' : ''}`,
  ];
  if (view.autopilotAnswer !== null) {
    lines.push(`${style.muted('Autopilot answer:')} ${firstLine(view.autopilotAnswer)}`);
  }
  const reason = stopReason(view);
  if (reason) lines.push(style.danger(`Stopped: ${reason}`));
  if (view.runs.length > 0) {
    lines.push(style.muted('Runs holding a place:'));
    lines.push(...queueRunLines(view.runs, style));
  }
  if (view.skipped.length > 0) {
    lines.push(style.muted('Skipped with a problem:'));
    lines.push(...queueRunLines(view.skipped, style));
  }
  if (view.items.length === 0) {
    lines.push('No tasks waiting.');
    return lines.join('\n');
  }
  lines.push(style.muted('Waiting:'));
  for (const item of view.items) {
    const body = item.groups
      ? `${item.groups.length} ${item.groups.length === 1 ? 'group' : 'groups'}`
      : firstLine(item.task ?? '');
    const title = item.title ? ` [${item.title}]` : '';
    const labels = formatTagLabels(item.tags, style);
    const tagText = labels === '' ? '' : `  ${labels}`;
    const delivery =
      (item.autoDeliver === null
        ? ''
        : item.autoDeliver
          ? ' · auto delivery'
          : ' · manual delivery') +
      (item.deliveryMode === null ? '' : ` · delivery: ${item.deliveryMode}`);
    const skipped = item.skip.length === 0 ? '' : ` · skip: ${item.skip.join(', ')}`;
    const mark =
      item.readiness === 'ready'
        ? ''
        : ` (${item.readiness === 'blocked' ? style.danger('blocked') : item.readiness})`;
    const after =
      item.after.length === 0
        ? ''
        : ` · after ${item.after
            .map((dependency) =>
              dependency.number === null
                ? dependency.id
                : `${taskNumber(dependency.number)} ${dependency.id}`,
            )
            .join(', ')}${mark}`;
    const postponed = item.postponed ? ' · postponed' : '';
    const error = item.error ? style.danger(` — error: ${item.error}`) : '';
    const returned =
      item.run === null ? '' : ` · ${item.hold ?? 'returns'} ${style.accent(item.run)}`;
    lines.push(
      `  ${item.position}. ${taskNumber(item.number)} ${style.accent(item.id)}  ${item.workflow}  ${body}${title}${tagText}${delivery}${skipped}${after}${postponed}${returned}  added ${addedAt(item.createdAt)}${error}`,
    );
  }
  return lines.join('\n');
}

export function formatRepositories(
  repositories: readonly RepositoryView[],
  style: Style = plainStyle,
): string {
  if (repositories.length === 0) return 'No repositories yet.';
  return table(
    [
      ['REPOSITORY', 'UNFINISHED', 'WAITING', 'QUEUED'],
      ...repositories.map((entry) => [
        entry.path,
        String(entry.unfinished),
        String(entry.waiting),
        String(entry.queued),
      ]),
    ],
    style,
  );
}
