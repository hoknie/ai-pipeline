import { type GroupWait, clockTime } from '../../feature/runs/types/index.ts';
import { formatDiff, limitNote } from './groups.ts';
import { runHints } from './hints.ts';
import { progressLine, stepsLine } from './run-steps.ts';
import { formatUsage } from './numbers.ts';
import { type Style, isTerminal, plainStyle, statusBadge } from './style.ts';
import { humanMark, runPipelineLabel, seconds, table, taskNumber } from './table.ts';
import { formatTagLabels } from './tags.ts';
import type { RunCreated, RunQueued, RunView, TagView } from '../ipc/contract/index.ts';

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

export function withTags(text: string, tags: readonly TagView[] | undefined, style: Style): string {
  const labels = formatTagLabels(tags, style);
  return labels === '' ? text : `${text} ${labels}`;
}

function shortTitle(title: string | undefined): string {
  if (!title) return '—';
  return title.length > 48 ? `${title.slice(0, 47)}…` : title;
}

export function formatRunList(runs: RunView[], style: Style = plainStyle): string {
  if (runs.length === 0) return 'No runs yet.';
  const withRepository = !isTerminal(style) || new Set(runs.map((run) => run.repository)).size > 1;
  const rows = [
    ['#', 'RUN', 'STATE', 'PIPELINE', 'TITLE', 'GROUPS', 'CHANGES', 'USAGE', 'REPOSITORY'],
    ...runs.map((run) => [
      taskNumber(run.number),
      style.accent(run.id),
      statusBadge(run.state, style),
      runPipelineLabel(run),
      withTags(shortTitle(run.title), run.tags, style),
      [
        run.split && run.split.status !== 'done' ? `split ${run.split.status}` : run.counts || '—',
        deliveryText(run),
        answersText(run),
      ]
        .filter(Boolean)
        .join(' · '),
      formatDiff(run.diff, style),
      formatUsage(run.usage, style),
      run.repository,
    ]),
  ];
  return table(withRepository ? rows : rows.map((row) => row.slice(0, -1)), style, { flex: 4 });
}

export function formatRun(
  run: RunView,
  now: number,
  style: Style = plainStyle,
  activity: readonly string[] = [],
): string {
  const header = [
    `Run ${taskNumber(run.number)} ${style.accent(run.id)} · ${runPipelineLabel(run)} · ${statusBadge(run.state, style)} · ${run.branch}`,
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
    `${style.muted('Groups:')} ${run.counts || '—'} (${run.total}) · usage ${formatUsage(run.usage, style)} · started ${seconds(now - run.createdAt)} ago`,
  ];
  for (const line of [stepsLine(run, style), progressLine(run, style)]) {
    if (line) header.push(line);
  }
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
  if (run.repair?.cancelReason) {
    header.push(style.danger(`Observer cancelled: ${run.repair.cancelReason}`));
  }
  const asked = run.system.find((step) => step.question);
  if (asked?.question) header.push(style.warning(`  question: ${asked.question}`));
  const answers = decisionLines(run, style);
  if (run.groups.length === 0) return [...header, ...answers].join('\n');
  const hints = runHints(run, style);
  const rows = groupTable(run, style);
  const blocks = [header, [rows], answers, [...activity], hints];
  return blocks
    .filter((block) => block.length > 0)
    .map((block) => block.join('\n'))
    .join('\n\n');
}

/** The table of the groups of a run. */
function groupTable(run: RunView, style: Style): string {
  return table(
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
            ? style.warning(
                `question${humanMark(group.humanOnly)}: ${group.question.split('\n')[0]}`,
              )
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
    { flex: 7 },
  );
}

/** `answers: human N, autopilot M, observer K` for the list of runs; empty without answers. */
function answersText(run: RunView): string {
  const decisions = run.decisions ?? [];
  const parts = (['human', 'autopilot', 'observer'] as const)
    .map((by) => [by, decisions.filter((decision) => decision.by === by).length] as const)
    .filter(([, count]) => count > 0)
    .map(([by, count]) => `${by} ${count}`);
  return parts.length > 0 ? `answers: ${parts.join(', ')}` : '';
}

/** The `Answers:` block of a run: one line per accepted answer; empty without answers. */
function decisionLines(run: RunView, style: Style): string[] {
  const decisions = run.decisions ?? [];
  if (decisions.length === 0) return [];
  const first = (text: string): string => text.split('\n')[0] ?? '';
  return [
    style.muted('Answers:'),
    ...decisions.map(
      (d) => `  ${d.group} · ${d.stepId} (${d.by}): ${first(d.question)} → ${first(d.answer)}`,
    ),
  ];
}

/** What a waiting group waits for, for the NOTE column. */
export function waitNote(wait: GroupWait | null | undefined, withProblem = true): string {
  if (!wait) return '';
  if (wait.reason === 'network') {
    if (wait.until !== null) return `waiting for network, until ${clockTime(wait.until)}`;
    return withProblem && wait.problem
      ? `waiting for network: ${wait.problem}`
      : 'waiting for network';
  }
  if (wait.reason === 'limit')
    return `waiting for ${wait.runtime} usage limit, until ${clockTime(wait.until)}`;
  if (wait.reason === 'specialist') return `waiting for ${wait.specialist}`;
  return `waiting for a free place (swarm.max ${wait.max})`;
}

const SYSTEM_NAMES = {
  split: 'split',
  message: 'message',
  resolve: 'resolver',
  repair: 'observer',
} as const;

function systemName(step: RunView['system'][number]): string {
  if (step.kind === 'action') return `${step.point ?? 'action'}:${step.action ?? step.slug}`;
  return SYSTEM_NAMES[step.kind];
}

/** `System:` line: actions, split, commit message, resolver and delivery in order; null when none. */
function systemLine(run: RunView, style: Style): string | null {
  const parts = (run.system ?? []).map((step) => {
    const detail = step.reason ? style.danger(step.reason) : waitNote(step.wait);
    return `${systemName(step)} ${statusBadge(step.status, style)}${detail ? ` (${detail})` : ''}`;
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

function deliveryText(run: RunView): string {
  const { applied, merged, failed, inProgress } = run.delivery;
  if (merged === 0) return '';
  const parts = [`applied ${applied}/${merged}`];
  if (failed > 0) parts.push(`apply_failed ${failed}`);
  if (inProgress) parts.push('delivering');
  return parts.join(' · ');
}
