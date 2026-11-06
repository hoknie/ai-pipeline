import type {
  AipConnection,
  AipDiff,
  AipEvent,
  AipGroup,
  AipGroupStatus,
  AipQuestion,
  AipRun,
  AipUsage,
} from '../types';

import { DELIVERY, STATUS, progressBar, type StatusStyle } from './theme.ts';

export const NOTIFIED_LIMIT = 500;
export const SPLIT_SLUG = '_split';

const SUMMARY_ORDER: readonly AipGroupStatus[] = ['running', 'needs_human', 'failed', 'conflict'];

const UNFINISHED: readonly AipGroupStatus[] = [
  'queued',
  'waiting',
  'running',
  'needs_human',
  'merging',
  'conflict',
];

export type GroupAction = 'answer' | 'retry' | 'cancel' | 'apply';
export type RunAction = 'cancel' | 'apply';

export type Notice = { key: string; text: string };

export type RunCommand = { pipeline: string; task: string };
export type ApplyCommand = { runId: string; groups: string[]; force: boolean };
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type ApplyGroupResult = {
  slug: string;
  delivery: { state: string; reason: string | null; files: string[]; conflicts: string[] };
};
export type ApplyResult = { runId: string; pending: boolean; groups: ApplyGroupResult[] };
export type RunCreated = {
  runId: string;
  branch: string;
  groups: { slug: string; title: string }[];
  split: boolean;
  warnings: string[];
};

export type RunQueued = {
  item: string;
  run: RunCreated | null;
  queue: {
    status: string;
    parallel: number;
    items: { id: string; position: number }[];
    runs: unknown[];
  };
};

export function aipArgv(option: unknown): string[] {
  const words =
    typeof option === 'string'
      ? option.split(/\s+/)
      : Array.isArray(option)
        ? option.filter((word): word is string => typeof word === 'string')
        : [];
  const argv = words.map((word) => word.trim()).filter((word) => word.length > 0);
  return argv.length > 0 ? argv : ['aip'];
}

export function splitLines(pending: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (pending + chunk).split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts.map((line) => line.trim()).filter((line) => line.length > 0), rest };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRun(value: unknown): value is AipRun {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.pipeline === 'string' &&
    typeof value.finished === 'boolean' &&
    Array.isArray(value.groups) &&
    value.groups.every(
      (group) =>
        isObject(group) && typeof group.slug === 'string' && typeof group.status === 'string',
    )
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseEvent(line: string): AipEvent | null {
  const value = parseJson(line);
  if (!isObject(value) || typeof value.seq !== 'number') return null;
  if (value.event === 'snapshot' && Array.isArray(value.runs) && value.runs.every(isRun))
    return { event: 'snapshot', seq: value.seq, runs: value.runs };
  if (value.event === 'run' && isRun(value.run))
    return { event: 'run', seq: value.seq, run: value.run };
  return null;
}

export function parseRuns(stdout: string): AipRun[] | null {
  const value = parseJson(stdout);
  return Array.isArray(value) && value.every(isRun) ? value : null;
}

export function parseRunView(stdout: string): AipRun | null {
  const value = parseJson(stdout);
  return isRun(value) ? value : null;
}

export function parseApplyResult(stdout: string): ApplyResult | null {
  const value = parseJson(stdout);
  if (!isObject(value) || typeof value.runId !== 'string' || !Array.isArray(value.groups))
    return null;
  return value as ApplyResult;
}

function isRunCreated(value: unknown): value is RunCreated {
  return isObject(value) && typeof value.runId === 'string' && Array.isArray(value.groups);
}

function asRunQueued(value: unknown): RunQueued | null {
  if (!isObject(value) || typeof value.item !== 'string' || !isObject(value.queue)) return null;
  const { queue } = value;
  if (!Array.isArray(queue.items) || !Array.isArray(queue.runs)) return null;
  if (typeof queue.parallel !== 'number' || typeof queue.status !== 'string') return null;
  if (value.run !== null && !isRunCreated(value.run)) return null;
  return value as RunQueued;
}

export function parseRunQueued(stdout: string): RunQueued | null {
  return asRunQueued(parseJson(stdout));
}

function queuePosition(queued: RunQueued): number {
  return queued.queue.items.find((item) => item.id === queued.item)?.position ?? 0;
}

export function applyEvent(runs: readonly AipRun[], event: AipEvent): AipRun[] {
  if (event.event === 'snapshot') return [...event.runs];
  const index = runs.findIndex((run) => run.id === event.run.id);
  if (index === -1) return [event.run, ...runs];
  return runs.map((run, position) => (position === index ? event.run : run));
}

export function activeRuns(runs: readonly AipRun[]): AipRun[] {
  return runs.filter((run) => !run.finished);
}

export function splitGroup(run: AipRun): AipGroup | null {
  if (!run.split || run.split.status === 'done') return null;
  return {
    slug: SPLIT_SLUG,
    title: 'split the task into groups',
    status: run.split.status,
    step: null,
    round: null,
    durationMs: 0,
    question: run.split.question,
    questions: run.split.questions ?? null,
    diff: null,
    reason: run.split.reason,
    warnings: 0,
    delivery: 'pending',
  };
}

export function runGroups(run: AipRun): AipGroup[] {
  const split = splitGroup(run);
  return split ? [split, ...run.groups] : run.groups;
}

export function missingMessage(argv: readonly string[], detail: string): string {
  return `cannot run \`${argv.join(' ')}\` (${detail}). Set the aipCommand option of the aip plugin to the command that runs aip, e.g. ["node", "/path/to/ai-pipeline/dist/cli/main.js"].`;
}

const STATUS_RUN_LABEL_MAX = 30;

function shortLabel(text: string): string {
  return text.length > STATUS_RUN_LABEL_MAX ? `${text.slice(0, STATUS_RUN_LABEL_MAX - 1)}…` : text;
}

export function statusSummary(runs: readonly AipRun[], connection: AipConnection): string {
  if (connection.mode === 'missing') return 'aip: command not found, set the aipCommand option';
  const active = activeRuns(runs);
  if (active.length === 0) {
    if (connection.mode === 'polling' && connection.error) return 'aip: offline';
    if (connection.mode === 'connecting') return 'aip: connecting';
    return 'aip: idle';
  }
  const counts = new Map<AipGroupStatus, number>();
  for (const run of active)
    for (const group of runGroups(run))
      counts.set(group.status, (counts.get(group.status) ?? 0) + 1);
  const head = active.length === 1 ? shortLabel(runLabel(active[0]!)) : `${active.length} runs`;
  const parts = [head];
  for (const status of SUMMARY_ORDER) {
    const n = counts.get(status) ?? 0;
    if (n === 0) continue;
    if (status === 'needs_human') parts.push(`${n} ${n === 1 ? 'question' : 'questions'}`);
    else parts.push(`${n} ${status}`);
  }
  return `aip: ${parts.join(' · ')}`;
}

export function firstLine(text: string | null): string {
  return (text ?? '').split('\n', 1)[0]?.trim() ?? '';
}

function groupNotice(run: AipRun, group: AipGroup): Notice | null {
  const detail = firstLine(group.status === 'needs_human' ? group.question : group.reason);
  const key = `${run.id}/${group.slug}/${group.status}/${group.step ?? ''}/${group.round ?? ''}/${detail}`;
  const who = `${group.slug} · ${runLabel(run)}`;
  if (group.status === 'needs_human') return { key, text: `${who} asks: ${detail}` };
  if (group.status === 'failed')
    return { key, text: `${who} failed${detail ? `: ${detail}` : ''}` };
  if (group.status === 'conflict') return { key, text: `${who} has a merge conflict` };
  return null;
}

export function currentNotices(runs: readonly AipRun[]): Notice[] {
  const notices: Notice[] = [];
  for (const run of runs) {
    for (const group of runGroups(run)) {
      const notice = groupNotice(run, group);
      if (notice) notices.push(notice);
      if (group.delivery === 'apply_failed')
        notices.push({
          key: `${run.id}/${group.slug}/apply_failed`,
          text: `delivery of ${group.slug} failed (${runLabel(run)})`,
        });
    }
    if (run.finished)
      notices.push({
        key: `${run.id}/finished`,
        text: `run ${runLabel(run)} (${run.pipeline}) finished: ${run.counts}`,
      });
  }
  return notices;
}

export function newNotices(
  runs: readonly AipRun[],
  notified: readonly string[],
  isFirstLoad: boolean,
): { notices: Notice[]; notified: string[] } {
  const seen = new Set(notified);
  const fresh = currentNotices(runs).filter((notice) => !seen.has(notice.key));
  const shown = isFirstLoad
    ? fresh.filter((notice) => notice.key.includes('/needs_human/'))
    : fresh;
  return {
    notices: shown,
    notified: [...notified, ...fresh.map((notice) => notice.key)].slice(-NOTIFIED_LIMIT),
  };
}

export function selectedRun(runs: readonly AipRun[], selected: string | null): AipRun | null {
  return runs.find((run) => run.id === selected) ?? activeRuns(runs)[0] ?? runs[0] ?? null;
}

export function groupActions(group: AipGroup): GroupAction[] {
  const actions: GroupAction[] = [];
  if (group.status === 'needs_human') actions.push('answer');
  if (group.status === 'failed' || group.status === 'conflict') actions.push('retry');
  if (UNFINISHED.includes(group.status)) actions.push('cancel');
  if (group.status === 'merged' && group.delivery !== 'applied') actions.push('apply');
  return actions;
}

export function runActions(run: AipRun): RunAction[] {
  const actions: RunAction[] = [];
  if (!run.finished) actions.push('cancel');
  if (
    !run.delivery.inProgress &&
    run.groups.some((group) => group.status === 'merged' && group.delivery !== 'applied')
  )
    actions.push('apply');
  return actions;
}

export function formatDuration(milliseconds: number): string {
  const total = Math.round(milliseconds / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatUsage(usage: AipUsage | null): string {
  if (!usage) return 'no usage yet';
  const tokens = `${usage.inputTokens} in / ${usage.outputTokens} out`;
  return usage.costUsd === null ? tokens : `$${usage.costUsd.toFixed(4)} · ${tokens}`;
}

export type ApplyDescription = { text: string; plain: string; isError: boolean };

export function describeApply(result: ApplyResult): ApplyDescription {
  const run = `**${result.runId}**`;
  if (result.pending)
    return {
      text: `${run}: the commit message is being written; delivery follows.`,
      plain: `Run ${result.runId}: the commit message is being written; delivery follows.`,
      isError: false,
    };
  if (result.groups.length === 0)
    return {
      text: `${run}: nothing to apply.`,
      plain: `Run ${result.runId}: nothing to apply.`,
      isError: false,
    };
  const plain = result.groups.map(({ slug, delivery }) => {
    const files = delivery.files.length > 0 ? ` (files: ${delivery.files.join(', ')})` : '';
    const conflicts =
      delivery.conflicts.length > 0 ? `; conflicts: ${delivery.conflicts.join(', ')}` : '';
    if (delivery.state === 'apply_failed')
      return `${slug}: apply failed: ${delivery.reason ?? 'unknown reason'}${files}`;
    return `${slug}: ${delivery.state}${files}${conflicts}`;
  });
  const lines = result.groups.map(({ slug, delivery }) => {
    const files = delivery.files.length > 0 ? ` (files: ${delivery.files.join(', ')})` : '';
    const conflicts =
      delivery.conflicts.length > 0 ? `; conflicts: ${delivery.conflicts.join(', ')}` : '';
    if (delivery.state === 'apply_failed')
      return `- ${DELIVERY.apply_failed.icon} **${slug}**: apply failed: ${delivery.reason ?? 'unknown reason'}${files}`;
    const style = DELIVERY[delivery.state as keyof typeof DELIVERY];
    return `- ${style?.icon ?? '•'} **${slug}**: ${delivery.state}${files}${conflicts}`;
  });
  return {
    text: lines.join('\n'),
    plain: plain.join('\n'),
    isError: result.groups.some((group) => group.delivery.state === 'apply_failed'),
  };
}

export function describeRunCreated(created: RunCreated): string {
  const lines = [`**${created.runId}** started on \`${created.branch}\``];
  if (created.split) lines.push('', 'The task is being split into groups first.');
  else {
    lines.push('');
    for (const group of created.groups) lines.push(`- **${group.slug}** — ${group.title}`);
  }
  for (const warning of created.warnings) lines.push('', `${STATUS.conflict.icon} ${warning}`);
  return lines.join('\n');
}

export function describeRunQueued(queued: RunQueued): string {
  if (queued.run) return describeRunCreated(queued.run);
  const { queue } = queued;
  return `**${queued.item}** queued at position ${queuePosition(queued)} · ${queue.runs.length} of ${queue.parallel} places taken`;
}

function words(args: string): string[] {
  return args.split(/\s+/).filter((word) => word.length > 0);
}

export function parseRunCommand(args: string): Parsed<RunCommand> {
  const trimmed = args.trim();
  const match = /^(\S+)\s+([\s\S]+)$/.exec(trimmed);
  if (!match?.[1] || !match[2]?.trim())
    return { ok: false, error: 'Usage: /aip:run <pipeline> <task>' };
  return { ok: true, value: { pipeline: match[1], task: match[2].trim() } };
}

export function parseStatusCommand(args: string): Parsed<string | null> {
  const list = words(args);
  if (list.length > 1) return { ok: false, error: 'Usage: /aip:status [run-id]' };
  return { ok: true, value: list[0] ?? null };
}

export function parseApplyCommand(args: string): Parsed<ApplyCommand> {
  const list = words(args);
  const unknown = list.find((word) => word.startsWith('-') && word !== '--force');
  if (unknown)
    return {
      ok: false,
      error: `Unknown option ${unknown}. Usage: /aip:apply <run-id> [group...] [--force]`,
    };
  const positional = list.filter((word) => !word.startsWith('-'));
  const [runId, ...groups] = positional;
  if (!runId) return { ok: false, error: 'Usage: /aip:apply <run-id> [group...] [--force]' };
  return { ok: true, value: { runId, groups, force: list.includes('--force') } };
}

export function applyArgv(command: ApplyCommand, json: boolean): string[] {
  return [
    'run',
    'apply',
    command.runId,
    ...command.groups,
    ...(command.force ? ['--force'] : []),
    ...(json ? ['--json'] : []),
  ];
}

export const WEB_USAGE = 'Usage: /aip:web [start|stop|restart|status] [--port <n>]';

export type WebAction = 'start' | 'stop' | 'restart' | 'status';
export type WebCommand = { action: WebAction; port: number | null };

const WEB_ACTIONS: readonly string[] = ['start', 'stop', 'restart', 'status'];

export function parseWebCommand(args: string): Parsed<WebCommand> {
  const usage = { ok: false, error: WEB_USAGE } as const;
  const list = words(args);
  let action: WebAction | null = null;
  let port: number | null = null;
  for (let index = 0; index < list.length; index += 1) {
    const word = list[index] ?? '';
    if (word === '--port') {
      const value = list[index + 1] ?? '';
      if (port !== null || !/^\d+$/.test(value) || Number(value) > 65535) return usage;
      port = Number(value);
      index += 1;
    } else if (WEB_ACTIONS.includes(word) && action === null) {
      action = word as WebAction;
    } else {
      return usage;
    }
  }
  return { ok: true, value: { action: action ?? 'start', port } };
}

export function webArgv(port: number | null): string[] {
  return port === null ? ['web'] : ['web', '--port', String(port)];
}

export function parseWebUrl(line: string): string | null {
  const match = /^aip web:\s*(https?:\/\/\S+)\s*$/.exec(line.trim());
  return match?.[1] ?? null;
}

export function errorText(stdout: string, stderr: string, exitCode: number): string {
  const text = (stderr.trim() || stdout.trim()).replace(/^aip:\s*/, '');
  return text || `aip exited with code ${exitCode}`;
}

// ---------------------------------------------------------------- display model

/** The name of a run: the one it was given, otherwise its id. */
export function runLabel(run: AipRun): string {
  const title = run.title?.trim();
  return title ? title : run.id;
}

export function runProgress(run: AipRun): { done: number; total: number } {
  const done = run.groups.filter(
    (group) => group.status === 'merged' || group.status === 'cancelled',
  ).length;
  return { done, total: Math.max(run.total, run.groups.length) };
}

export function formatDiff(diff: AipDiff | null | undefined): string | null {
  if (!diff) return null;
  return `${diff.files} ${diff.files === 1 ? 'file' : 'files'} +${diff.added} −${diff.removed}`;
}

/** Unfinished runs first, then newest first. */
export function sortRuns(runs: readonly AipRun[]): AipRun[] {
  return [...runs].sort(
    (a, b) => Number(a.finished) - Number(b.finished) || b.createdAt - a.createdAt,
  );
}

const ATTENTION: readonly AipGroupStatus[] = ['needs_human', 'conflict', 'failed'];
export const ATTENTION_SHOWN = 5;
export const RUNS_SHOWN = 8;
export const COMPACT_COLUMNS = 100;

export type AttentionItem = {
  runId: string;
  slug: string;
  status: AipGroupStatus | 'apply_failed';
  runLabel: string;
  text: string;
  style: StatusStyle;
};

export function attentionItems(runs: readonly AipRun[]): { items: AttentionItem[]; more: number } {
  const all: AttentionItem[] = [];
  for (const run of sortRuns(runs)) {
    for (const group of runGroups(run)) {
      if (ATTENTION.includes(group.status)) {
        const detail = firstLine(group.status === 'needs_human' ? group.question : group.reason);
        all.push({
          runId: run.id,
          slug: group.slug,
          status: group.status,
          runLabel: runLabel(run),
          text: detail || STATUS[group.status].label,
          style: STATUS[group.status],
        });
      } else if (group.delivery === 'apply_failed') {
        all.push({
          runId: run.id,
          slug: group.slug,
          status: 'apply_failed',
          runLabel: runLabel(run),
          text: DELIVERY.apply_failed.label,
          style: DELIVERY.apply_failed,
        });
      }
    }
  }
  return { items: all.slice(0, ATTENTION_SHOWN), more: Math.max(0, all.length - ATTENTION_SHOWN) };
}

const RUN_STATUS_ORDER: readonly AipGroupStatus[] = [
  'needs_human',
  'conflict',
  'failed',
  'running',
  'merging',
  'waiting',
  'queued',
];

function runStatus(run: AipRun): AipGroupStatus {
  const groups = runGroups(run);
  const found = RUN_STATUS_ORDER.find((status) => groups.some((group) => group.status === status));
  if (found && (!run.finished || found === 'failed' || found === 'conflict')) return found;
  if (run.finished)
    return groups.some((group) => group.status === 'merged') ? 'merged' : 'cancelled';
  return 'running';
}

export function formatAge(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function costOf(usage: AipUsage | null): string | null {
  return usage && usage.costUsd !== null ? `$${usage.costUsd.toFixed(2)}` : null;
}

export type PaneOptions = { compact: boolean; now: number };

export type RunRow = {
  id: string;
  label: string;
  style: StatusStyle;
  isSelected: boolean;
  isDim: boolean;
  hotkey: string | null;
  bar: string;
  done: number;
  total: number;
  age: string | null;
  cost: string | null;
};

export type GroupCard = {
  slug: string;
  title: string;
  style: StatusStyle;
  step: string | null;
  round: number | null;
  duration: string;
  diff: string | null;
  delivery: StatusStyle | null;
  question: string | null;
  questions: AipQuestion[] | null;
  reason: string | null;
  actions: GroupAction[];
};

export type RunCard = {
  id: string;
  label: string;
  pipeline: string;
  phase: string;
  style: StatusStyle;
  diff: string | null;
  delivery: string;
  cost: string;
  actions: RunAction[];
  groups: GroupCard[];
};

export type ConnectionLine = { icon: string; label: string; color: string; note: string | null };

export type PaneView = {
  summary: string;
  connection: ConnectionLine;
  note: { text: string; color: string | null } | null;
  attention: { items: AttentionItem[]; more: number };
  runs: RunRow[];
  hiddenRuns: number;
  isEmpty: boolean;
  card: RunCard | null;
};

function connectionOf(connection: AipConnection): {
  line: ConnectionLine;
  note: PaneView['note'];
} {
  if (connection.mode === 'missing')
    return {
      line: { icon: '✕', label: 'offline', color: 'error', note: connection.error },
      note: { text: `aip: ${connection.error ?? 'cannot be run'}`, color: 'error' },
    };
  if (connection.mode === 'connecting')
    return {
      line: { icon: '◌', label: 'connecting', color: 'inactive', note: null },
      note: { text: 'Connecting to aip…', color: null },
    };
  if (connection.mode === 'polling')
    return {
      line: { icon: '◌', label: 'polling', color: 'warning', note: connection.error },
      note: {
        text: `Event stream lost, polling every 2 s${connection.error ? `: ${connection.error}` : ''}`,
        color: 'warning',
      },
    };
  return { line: { icon: '●', label: 'live', color: 'success', note: null }, note: null };
}

function groupCard(group: AipGroup): GroupCard {
  const questions = group.questions && group.questions.length > 0 ? group.questions : null;
  return {
    slug: group.slug,
    title: group.title,
    style: STATUS[group.status],
    step: group.step,
    round: group.round,
    duration: formatDuration(group.durationMs),
    diff: formatDiff(group.diff),
    delivery: group.status === 'merged' ? DELIVERY[group.delivery] : null,
    question: group.question,
    questions,
    reason: group.reason,
    actions: groupActions(group),
  };
}

function phaseOf(run: AipRun): string {
  if (run.state === 'needs_human') return 'needs you';
  if (
    run.state === 'active' ||
    run.state === 'finished' ||
    run.state === 'cancelled' ||
    run.state === 'failed'
  )
    return run.state;
  return run.finished ? 'finished' : 'active';
}

export function paneView(
  runs: readonly AipRun[],
  selected: string | null,
  connection: AipConnection,
  options: PaneOptions,
): PaneView {
  const sorted = sortRuns(runs);
  const current = selectedRun(sorted, selected);
  const attention = attentionItems(sorted);
  const total = attention.items.length + attention.more;
  const active = activeRuns(sorted).length;
  const summary = ['aip']
    .concat(active > 0 ? [`${active} active`] : [])
    .concat(total > 0 ? [`${total} ${total === 1 ? 'needs' : 'need'} you`] : [])
    .join(' · ');
  const shown = sorted.slice(0, RUNS_SHOWN);
  const { line, note } = connectionOf(connection);
  return {
    summary,
    connection: line,
    note,
    attention,
    runs: shown.map((run, index) => {
      const progress = runProgress(run);
      return {
        id: run.id,
        label: runLabel(run),
        style: STATUS[runStatus(run)],
        isSelected: run.id === current?.id,
        isDim: run.finished,
        hotkey: String(index + 1),
        bar: progressBar(progress.done, progress.total),
        ...progress,
        age: options.compact ? null : formatAge(options.now - run.createdAt),
        cost: options.compact ? null : costOf(run.usage),
      };
    }),
    hiddenRuns: Math.max(0, sorted.length - shown.length),
    isEmpty: sorted.length === 0,
    card: current
      ? {
          id: current.id,
          label: runLabel(current),
          pipeline: current.pipeline,
          phase: phaseOf(current),
          style: STATUS[runStatus(current)],
          diff: formatDiff(current.diff),
          delivery: `delivered ${current.delivery.applied}/${current.delivery.merged}${
            current.delivery.failed > 0 ? ` · ${current.delivery.failed} failed` : ''
          }${current.delivery.inProgress ? ' · in progress' : ''}`,
          cost: formatUsage(current.usage),
          actions: runActions(current),
          groups: runGroups(current).map(groupCard),
        }
      : null,
  };
}

// ---------------------------------------------------------------- questions

export function draftKey(runId: string, slug: string, index?: number): string {
  return index === undefined ? `${runId}/${slug}` : `${runId}/${slug}/q${index + 1}`;
}

/** The answer of each question: the draft, else the recommendation, else empty. */
export function resolveAnswers(
  questions: readonly AipQuestion[],
  draftOf: (index: number) => string | undefined,
): string[] {
  return questions.map(
    (question, index) => draftOf(index)?.trim() || question.recommendation?.trim() || '',
  );
}

/** 1-based numbers of the questions that have no answer. */
export function missingAnswers(answers: readonly string[]): number[] {
  return answers.flatMap((answer, index) => (answer.trim() === '' ? [index + 1] : []));
}

export function answerText(questions: readonly AipQuestion[], answers: readonly string[]): string {
  return questions
    .map(
      (question, index) =>
        `Q${index + 1}: ${question.text}\nA${index + 1}: ${answers[index] ?? ''}`,
    )
    .join('\n\n');
}

// ---------------------------------------------------------------- markdown output

function runLine(run: AipRun): string {
  const progress = runProgress(run);
  const parts = [
    `${STATUS[runStatus(run)].icon} **${runLabel(run)}**`,
    `\`${run.id}\``,
    `${progress.done}/${progress.total}`,
    formatDiff(run.diff),
    costOf(run.usage),
  ].filter((part): part is string => part !== null);
  return `- ${parts.join(' · ')}`;
}

export function statusMarkdown(runs: readonly AipRun[]): string {
  if (runs.length === 0) return 'No runs yet. Start one with `/aip:run <pipeline> <task>`.';
  return sortRuns(runs).map(runLine).join('\n');
}

export function runMarkdown(run: AipRun): string {
  const progress = runProgress(run);
  const head = [
    `### ${STATUS[runStatus(run)].icon} ${runLabel(run)} · \`${run.id}\``,
    '',
    [
      run.pipeline,
      phaseOf(run),
      `${progress.done}/${progress.total}`,
      formatDiff(run.diff),
      formatUsage(run.usage),
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
    '',
  ];
  const groups = runGroups(run).map((group) => {
    const style = STATUS[group.status];
    const detail = firstLine(group.status === 'needs_human' ? group.question : group.reason);
    const parts = [
      `${style.icon} **${group.slug}** ${style.label}`,
      group.step ? `step ${group.step}` : null,
      group.round !== null ? `round ${group.round}` : null,
      formatDuration(group.durationMs),
      formatDiff(group.diff),
      detail ? `“${detail}”` : null,
    ].filter((part): part is string => part !== null);
    return `- ${parts.join(' · ')}`;
  });
  return [...head, ...groups].join('\n');
}

// ---------------------------------------------------------------- tool rows

const AIP_TOOLS: readonly string[] = [
  'run',
  'status',
  'group',
  'cancel',
  'retry',
  'answer',
  'apply',
  'queue',
  'queue_add',
  'queue_edit',
  'queue_remove',
  'queue_start',
  'queue_parallel',
  'queue_pause',
];

/** `mcp__aip__swarm_status` → `status`; null for any other tool. */
export function parseAipTool(name: string): string | null {
  const match = /^mcp__(.+)__swarm_([a-z_]+)$/.exec(name);
  const tool = match?.[2];
  return tool && AIP_TOOLS.includes(tool) ? tool : null;
}

function textOf(output: unknown): string | null {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const texts = output.flatMap((part) =>
      isObject(part) && typeof part.text === 'string' ? [part.text] : [],
    );
    return texts.length > 0 ? texts.join('\n') : null;
  }
  if (isObject(output) && 'content' in output) return textOf(output.content);
  return null;
}

/** The JSON the host tools append to their text: the last ```json block. */
export function toolData(output: unknown): unknown {
  const text = textOf(output);
  if (text === null) return null;
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  const last = blocks.at(-1)?.[1];
  if (last === undefined) return null;
  return parseJson(last) ?? null;
}

function waitingOf(run: AipRun): number {
  return typeof run.waiting === 'number'
    ? run.waiting
    : runGroups(run).filter((group) => group.status === 'needs_human').length;
}

function runPart(run: AipRun): string {
  const progress = runProgress(run);
  const waiting = waitingOf(run);
  return `${runLabel(run)} ${progress.done}/${progress.total}${waiting > 0 ? ` · ${waiting} needs answer` : ''}`;
}

export function toolSummary(tool: string, data: unknown): string | null {
  return toolOutcome(tool, data)?.text ?? null;
}

/** The one-line summary of a host tool result and whether it reports a failure. */
export function toolOutcome(tool: string, data: unknown): { text: string; failed: boolean } | null {
  const text = summaryText(tool, data);
  if (text === null) return null;
  const failed =
    tool === 'apply' &&
    isObject(data) &&
    Array.isArray(data.groups) &&
    (data as ApplyResult).groups.some((one) => one.delivery.state === 'apply_failed');
  return { text, failed };
}

function summaryText(tool: string, data: unknown): string | null {
  const head = `aip · ${tool.replace(/_/g, ' ')} —`;
  if (tool === 'status') {
    if (isRun(data)) return `${head} ${runPart(data)}`;
    if (Array.isArray(data) && data.every(isRun)) {
      const active = activeRuns(data);
      if (active.length === 0) return `${head} no active runs`;
      return `${head} ${active.length} active: ${active.map(runPart).join('; ')}`;
    }
    return null;
  }
  if (tool === 'run') {
    const queued = asRunQueued(data);
    if (!queued) return null;
    const created = queued.run;
    if (!created) return `${head} ${queued.item} queued at position ${queuePosition(queued)}`;
    return created.split
      ? `${head} ${created.runId} started, splitting the task`
      : `${head} ${created.runId} started: ${created.groups.map((group) => group.slug).join(', ')}`;
  }
  if (tool === 'apply') {
    if (!isObject(data) || typeof data.runId !== 'string' || !Array.isArray(data.groups))
      return null;
    const result = data as ApplyResult;
    if (result.pending) return `${head} ${result.runId}: commit message is being written`;
    if (result.groups.length === 0) return `${head} ${result.runId}: nothing to apply`;
    const failed = result.groups.filter((one) => one.delivery.state === 'apply_failed').length;
    const applied = result.groups.filter((one) => one.delivery.state === 'applied').length;
    return `${head} ${result.runId}: ${applied} applied${failed > 0 ? ` · ${failed} failed` : ''}`;
  }
  if (tool === 'cancel' || tool === 'retry' || tool === 'answer')
    return isRun(data) ? `${head} ${runLabel(data)} (${data.id})` : null;
  if (tool === 'group') {
    if (!isObject(data) || typeof data.slug !== 'string' || typeof data.status !== 'string')
      return null;
    return `${head} ${data.slug} ${data.status}`;
  }
  if (tool.startsWith('queue')) {
    if (!isObject(data) || !Array.isArray(data.items)) return null;
    const status = typeof data.status === 'string' ? `, ${data.status}` : '';
    return `${head} ${data.items.length} queued${status}`;
  }
  return null;
}
