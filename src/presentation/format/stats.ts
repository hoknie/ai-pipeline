import type { StatsReportView } from '../ipc/contract/index.ts';
import { type Style, plainStyle } from './style.ts';
import { addedAt, table } from './table.ts';

type Breakdown = StatsReportView['bySpecialist'][number];

/** `950`, `12.5k`, `3.2M`. */
export function formatTokens(value: number): string {
  const short = (amount: number, suffix: string): string =>
    `${amount.toFixed(1).replace(/\.0$/, '')}${suffix}`;
  if (value >= 1_000_000) return short(value / 1_000_000, 'M');
  if (value >= 1000) return short(value / 1000, 'k');
  return String(Math.round(value));
}

/** `1h 30m`, `45m`, `30s`. */
export function formatSpan(milliseconds: number): string {
  const total = Math.round(milliseconds / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest}m`;
}

/** `$0.42`, or `—` when the cost is unknown or hidden. */
export function formatCost(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

function period(report: StatsReportView): string {
  const from = report.since === null ? 'all time' : `from ${addedAt(report.since)}`;
  const to = report.until === null ? '' : ` to ${addedAt(report.until)}`;
  const scope = report.repository === null ? 'all projects' : report.repository;
  return `${from}${to} · ${scope}`;
}

function breakdown(title: string, rows: Breakdown[], style: Style): string[] {
  if (rows.length === 0) return [];
  const body = rows.map((row) => [
    row.key,
    String(row.attempts),
    formatTokens(row.tokens),
    formatCost(row.costUsd),
    formatSpan(row.agentMs),
    formatTokens(row.tokensPerAttempt),
  ]);
  const header = [title, 'attempts', 'tokens', 'cost', 'agent time', 'tokens/attempt'];
  return ['', table([header, ...body], style)];
}

function projects(report: StatsReportView, style: Style): string[] {
  if (report.projects.length === 0) return [];
  const rows = report.projects.map((project) => [
    project.repository,
    String(project.totals.tasks),
    formatTokens(project.totals.tokens),
    formatCost(project.totals.costUsd),
    formatSpan(project.totals.agentMs),
    formatTokens(project.perTask.tokens.mean),
    formatSpan(project.perTask.wallMs.mean),
  ]);
  const header = ['project', 'tasks', 'tokens', 'cost', 'agent time', 'tokens/task', 'time/task'];
  return ['', table([header, ...rows], style)];
}

/** The text of `aip stats`. */
export function formatStats(report: StatsReportView, style: Style = plainStyle): string {
  const lines: string[] = [];
  if (!report.settings.enabled) {
    lines.push(style.warning('Collection is off: showing what was collected before.'));
  }
  lines.push(`${style.title('Usage')} ${period(report)}`);
  const { totals, perTask, outcomes } = report;
  lines.push(
    `Tasks ${totals.tasks} (finished ${outcomes.finished}, failed ${outcomes.failed}, cancelled ${outcomes.cancelled}) · attempts ${totals.attempts}`,
    `Tokens ${formatTokens(totals.tokens)} (in ${formatTokens(totals.inputTokens)}, out ${formatTokens(totals.outputTokens)}) · cost ${formatCost(totals.costUsd)}`,
    `Agent time ${formatSpan(totals.agentMs)} · commands ${formatSpan(totals.commandMs)} · task time ${formatSpan(totals.wallMs)}`,
    '',
    table(
      [
        ['per task', 'mean', 'median'],
        ['tokens', formatTokens(perTask.tokens.mean), formatTokens(perTask.tokens.median)],
        ['cost', formatCost(perTask.costUsd.mean), formatCost(perTask.costUsd.median)],
        ['agent time', formatSpan(perTask.agentMs.mean), formatSpan(perTask.agentMs.median)],
        ['task time', formatSpan(perTask.wallMs.mean), formatSpan(perTask.wallMs.median)],
      ],
      style,
    ),
    ...projects(report, style),
    ...breakdown('specialist', report.bySpecialist, style),
    ...breakdown('model', report.byModel, style),
    ...breakdown('pipeline', report.byPipeline, style),
    ...breakdown('runtime', report.byRuntime, style),
  );
  return lines.join('\n');
}
