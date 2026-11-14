import { type HintAction, hintLine } from './hints.ts';
import { stopReason } from './queue.ts';
import { progressBar } from './run-steps.ts';
import { type Style, statusBadge } from './style.ts';
import { humanMark, pipelineLabel, table, taskNumber } from './table.ts';
import type { QueueView, RepositoryView, RunView } from '../ipc/contract/index.ts';

export interface OverviewDaemon {
  version: string | null;
  pid: number | null;
  busy: boolean;
  network: 'off' | 'up' | 'down';
  /** Address of the panel the daemon serves; null when none runs. */
  panel: string | null;
}

export interface OverviewProject {
  repository: RepositoryView;
  queue: QueueView | null;
}

export interface OverviewData {
  daemon: OverviewDaemon;
  /** Enabled projects with unfinished runs or queued tasks. */
  projects: OverviewProject[];
  /** Every known project; resolves the short address of a run's repository. */
  repositories: RepositoryView[];
  /** The whole answer of `status`: unfinished runs and the latest finished ones. */
  runs: RunView[];
}

export type AttentionKind =
  'question' | 'failed' | 'conflict' | 'apply_failed' | 'delivery' | 'queue_stopped';

export interface AttentionItem {
  kind: AttentionKind;
  repository: string;
  /** Null for a stopped queue. */
  runId: string | null;
  number: number | null;
  group: string | null;
  /** First line of the question or the reason. */
  text: string;
  humanOnly: 'review' | 'request' | null;
}

function firstText(text: string | null | undefined, fallback = ''): string {
  const line = (text ?? '').split('\n').find((part) => part.trim() !== '');
  return line === undefined ? fallback : line.trim();
}

/** The short address of a project; the path when the project is unknown. */
function slugOf(data: OverviewData, path: string): string {
  const known = [...data.repositories, ...data.projects.map((project) => project.repository)];
  return known.find((repository) => repository.path === path)?.slug ?? path;
}

/** Unfinished runs, newest first. */
export function activeRuns(data: OverviewData): RunView[] {
  return data.runs.filter((run) => !run.finished).sort((a, b) => b.createdAt - a.createdAt);
}

function questions(data: OverviewData): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const run of data.runs) {
    const base = {
      repository: slugOf(data, run.repository),
      runId: run.id,
      number: run.number,
    };
    const rows = [
      ...run.groups.map((row) => ({ slug: row.slug, row })),
      ...(run.split ? [{ slug: '_split', row: run.split }] : []),
      ...run.system.map((row) => ({ slug: row.slug, row })),
    ];
    for (const { slug, row } of rows) {
      if (row.status !== 'needs_human') continue;
      items.push({
        ...base,
        kind: 'question',
        group: slug,
        text: firstText(row.question),
        humanOnly: row.humanOnly ?? null,
      });
    }
  }
  return items;
}

function failures(data: OverviewData): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const run of data.runs) {
    if (run.finished && !run.returnable) continue;
    for (const group of run.groups) {
      if (group.status !== 'failed' && group.status !== 'conflict') continue;
      items.push({
        kind: group.status,
        repository: slugOf(data, run.repository),
        runId: run.id,
        number: run.number,
        group: group.slug,
        text: firstText(group.reason, group.status),
        humanOnly: null,
      });
    }
  }
  return items;
}

function deliveries(data: OverviewData): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const run of data.runs) {
    const base = {
      repository: slugOf(data, run.repository),
      runId: run.id,
      number: run.number,
      group: null,
      humanOnly: null,
    };
    if (run.deliveryStage?.status === 'apply_failed') {
      items.push({
        ...base,
        kind: 'apply_failed',
        text: firstText(run.deliveryStage.reason, 'delivery failed'),
      });
    }
    const { merged, applied, inProgress } = run.delivery;
    if (!run.autoDeliver && merged > applied && !inProgress) {
      items.push({ ...base, kind: 'delivery', text: `${merged - applied} of ${merged} merged` });
    }
  }
  return items;
}

function stoppedQueues(data: OverviewData): AttentionItem[] {
  return data.projects.flatMap(({ repository, queue }) => {
    const text = queue ? stopReason(queue) : null;
    if (!queue || queue.stop === null) return [];
    return [
      {
        kind: 'queue_stopped' as const,
        repository: repository.slug,
        runId: null,
        number: null,
        group: null,
        text: firstText(text, 'stopped'),
        humanOnly: null,
      },
    ];
  });
}

/** What waits for a person, over all runs of the answer: questions, failures, deliveries, queues. */
export function attentionItems(data: OverviewData): AttentionItem[] {
  return [...questions(data), ...failures(data), ...deliveries(data), ...stoppedQueues(data)];
}

/** The command that helps with an item; null when no command fits. */
export function attentionAction(item: AttentionItem): HintAction | null {
  if (item.kind === 'queue_stopped') return { kind: 'queue_start', repository: item.repository };
  if (item.runId === null) return null;
  if (item.kind === 'delivery' || item.kind === 'apply_failed')
    return { kind: 'apply', runId: item.runId };
  if (item.group === null) return null;
  if (item.kind === 'question') return { kind: 'answer', runId: item.runId, group: item.group };
  return { kind: 'retry', runId: item.runId, group: item.group };
}

export function overviewJson(data: OverviewData): {
  daemon: OverviewDaemon;
  attention: AttentionItem[];
  projects: OverviewProject[];
  runs: RunView[];
} {
  return {
    daemon: data.daemon,
    attention: attentionItems(data),
    projects: data.projects,
    runs: activeRuns(data),
  };
}

function daemonLine(daemon: OverviewDaemon): string {
  const parts = [
    `aip ${daemon.version ?? 'unknown'}`,
    `daemon pid ${daemon.pid ?? 'unknown'}`,
    daemon.busy ? 'busy' : 'idle',
  ];
  if (daemon.network === 'down') parts.push('network down');
  if (daemon.panel !== null) parts.push(`panel ${daemon.panel}`);
  return parts.join(' · ');
}

function attentionLines(data: OverviewData, style: Style): string[] {
  const items = attentionItems(data);
  if (items.length === 0) return ['Needs you: nothing'];
  const lines = [style.title(`Needs you (${items.length}):`)];
  for (const item of items) {
    const who =
      item.runId === null
        ? item.repository
        : [taskNumber(item.number ?? 0), style.accent(item.runId), item.group]
            .filter((part) => part !== null)
            .join(' ');
    const label = item.kind === 'question' ? `question${humanMark(item.humanOnly)}` : item.kind;
    lines.push(`  ${who}  ${style.warning(`${label}: ${item.text}`)}`);
    const action = attentionAction(item);
    if (style.rich && action) lines.push(`    ${hintLine(action, style)}`);
  }
  return lines;
}

function projectLines(data: OverviewData, style: Style): string[] {
  if (data.projects.length === 0) return ['Projects: idle'];
  const rows = data.projects.map(({ repository, queue }) => [
    repository.slug,
    queue ? statusBadge(queue.status, style) : '—',
    queue ? `${queue.runs.length} of ${queue.parallel}` : '—',
    String(repository.unfinished),
    String(repository.waiting),
    String(repository.queued),
  ]);
  return [
    style.title('Projects:'),
    ...table([['PROJECT', 'QUEUE', 'PLACES', 'RUNS', 'WAITING', 'QUEUED'], ...rows], style)
      .split('\n')
      .map((line) => `  ${line}`),
  ];
}

function runLines(data: OverviewData, style: Style): string[] {
  const runs = activeRuns(data);
  if (runs.length === 0) return ['Runs: none active'];
  const lines = [style.title('Runs:')];
  for (const run of runs) {
    const { done, total } = run.progress;
    const bar = style.rich ? `${progressBar(done, total, style)} ` : '';
    lines.push(
      `  ${taskNumber(run.number)} ${style.accent(run.id)}  ${statusBadge(run.state, style)}  ${pipelineLabel(run.pipeline, run.pipelineName)}  ${run.title || '—'}  ${bar}${done}/${total} steps  ${slugOf(data, run.repository)}`,
    );
    for (const group of run.groups) {
      if (group.status !== 'running') continue;
      lines.push(`    ${group.slug}: ${group.stepName ?? group.step ?? '—'}`);
    }
  }
  return lines;
}

/** The summary of the whole swarm: daemon, what needs a person, projects and active runs. */
export function formatOverview(data: OverviewData, style: Style): string {
  return [
    daemonLine(data.daemon),
    attentionLines(data, style).join('\n'),
    projectLines(data, style).join('\n'),
    runLines(data, style).join('\n'),
  ].join('\n\n');
}
