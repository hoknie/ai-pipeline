import type {
  AipActionResult,
  AipConnection,
  AipGroup,
  AipGroupStatus,
  AipQuestion,
  AipRun,
} from '../types';

import {
  ATTENTION_SHOWN,
  RUNS_SHOWN,
  activeRuns,
  firstLine,
  formatAge,
  formatDiff,
  formatDuration,
  groupActions,
  runActions,
  runGroups,
  runLabel,
  runProgress,
  selectedRun,
  sortRuns,
  type GroupAction,
  type RunAction,
} from './feed.ts';
import {
  CONNECTION,
  DELIVERY,
  RESULT,
  SELECTED_MARK,
  STATUS,
  progressBar,
  type StatusStyle,
  type ThemeKey,
} from './theme.ts';

export type PanelInput = {
  runs: readonly AipRun[];
  selected: string | null;
  connection: AipConnection;
  action: AipActionResult | null;
};

export type PanelOptions = { compact: boolean; now: number };

export type ResultLine = { icon: string; text: string; color: ThemeKey };

export type RunLine = {
  id: string;
  label: string;
  style: StatusStyle;
  marker: string | null;
  isSelected: boolean;
  isDim: boolean;
  hotkey: string;
  bar: string | null;
  done: number;
  total: number;
  age: string | null;
  cost: string | null;
};

export type NeedRow = {
  runId: string;
  slug: string;
  runLabel: string;
  text: string;
  style: StatusStyle;
};

export type OpenQuestion = {
  runId: string;
  slug: string;
  title: string;
  question: string | null;
  questions: AipQuestion[] | null;
};

export type NeedsYou = { open: OpenQuestion[]; rows: NeedRow[]; more: number };

export type RunHeader = {
  id: string;
  label: string;
  style: StatusStyle;
  meta: string;
  actions: RunAction[];
};

export type GroupLine = {
  slug: string;
  style: StatusStyle;
  line: string;
  details: string | null;
  reason: string | null;
  actions: GroupAction[];
};

export type RunView = RunHeader & { groups: GroupLine[] };

export type HeaderLine = {
  summary: string;
  connection: StatusStyle;
};

export type PanelView = {
  header: HeaderLine;
  note: { text: string; color: ThemeKey | null } | null;
  result: ResultLine | null;
  needs: NeedsYou;
  runs: RunLine[];
  hiddenRuns: number;
  empty: boolean;
  run: RunView | null;
};

const ATTENTION: readonly AipGroupStatus[] = ['needs_human', 'conflict', 'failed'];

const RUN_STATE_ORDER: readonly AipGroupStatus[] = [
  'needs_human',
  'conflict',
  'failed',
  'running',
  'merging',
  'waiting',
  'queued',
];

/** The status symbol of a run: the most urgent status of its groups. */
export function runState(run: AipRun): AipGroupStatus {
  const groups = runGroups(run);
  const found = RUN_STATE_ORDER.find((status) => groups.some((group) => group.status === status));
  if (found && (!run.finished || found === 'failed' || found === 'conflict')) return found;
  if (run.finished)
    return groups.some((group) => group.status === 'merged') ? 'merged' : 'cancelled';
  return 'running';
}

const GROUP_RANK: Readonly<Record<AipGroupStatus, number>> = {
  needs_human: 0,
  conflict: 1,
  failed: 1,
  running: 2,
  merging: 2,
  queued: 3,
  waiting: 3,
  merged: 4,
  cancelled: 4,
};

/** Lower is more urgent. */
export function groupRank(status: AipGroupStatus): number {
  return GROUP_RANK[status];
}

/** Groups by urgency; the order inside one level is kept. */
export function orderGroups(groups: readonly AipGroup[]): AipGroup[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => groupRank(a.group.status) - groupRank(b.group.status) || a.index - b.index)
    .map((entry) => entry.group);
}

/**
 * The buttons of a group row. Answering lives in the Needs you strip; a run of one
 * group has the same cancel and apply on the run itself, so they are not doubled.
 */
export function paneGroupActions(run: AipRun, group: AipGroup): GroupAction[] {
  const single = runGroups(run).length === 1;
  return groupActions(group).filter(
    (action) => action !== 'answer' && !(single && (action === 'cancel' || action === 'apply')),
  );
}

export function connectionLine(connection: AipConnection): {
  style: StatusStyle;
  note: PanelView['note'];
} {
  const style = CONNECTION[connection.mode];
  if (connection.mode === 'missing')
    return { style, note: { text: `aip: ${connection.error ?? 'cannot be run'}`, color: 'error' } };
  if (connection.mode === 'connecting')
    return { style, note: { text: 'Connecting to aip…', color: null } };
  if (connection.mode === 'polling')
    return {
      style,
      note: {
        text: `Event stream lost, polling every 2 s${connection.error ? `: ${connection.error}` : ''}`,
        color: 'warning',
      },
    };
  return { style, note: null };
}

export function resultLine(action: AipActionResult | null): ResultLine | null {
  if (!action) return null;
  const kind = RESULT[action.isError ? 'error' : 'ok'];
  return { icon: kind.icon, text: action.text, color: kind.color };
}

function costOf(run: AipRun): string | null {
  return run.usage && run.usage.costUsd !== null ? `$${run.usage.costUsd.toFixed(2)}` : null;
}

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/** Cost when known and tokens as `in/out` when any; null without both. */
export function usageLabel(usage: AipRun['usage']): string | null {
  if (!usage) return null;
  const parts = [
    usage.costUsd !== null ? `$${usage.costUsd.toFixed(4)}` : null,
    usage.inputTokens > 0 || usage.outputTokens > 0
      ? `${compactTokens(usage.inputTokens)}/${compactTokens(usage.outputTokens)}`
      : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function runRow(
  run: AipRun,
  isSelected: boolean,
  index: number,
  options: PanelOptions,
): RunLine {
  const progress = runProgress(run);
  return {
    id: run.id,
    label: runLabel(run),
    style: STATUS[runState(run)],
    marker: isSelected ? SELECTED_MARK : null,
    isSelected,
    isDim: run.finished,
    hotkey: String(index + 1),
    bar: options.compact ? null : progressBar(progress.done, progress.total),
    ...progress,
    age: options.compact ? null : formatAge(options.now - run.createdAt),
    cost: options.compact ? null : costOf(run),
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

export function runHeader(run: AipRun, options: PanelOptions): RunHeader {
  const head = [run.id, run.pipeline, phaseOf(run)];
  const rest = options.compact
    ? []
    : [
        formatDiff(run.diff),
        `delivered ${run.delivery.applied}/${run.delivery.merged}${
          run.delivery.failed > 0 ? ` · ${run.delivery.failed} failed` : ''
        }${run.delivery.inProgress ? ' · in progress' : ''}`,
        usageLabel(run.usage),
      ];
  return {
    id: run.id,
    label: runLabel(run),
    style: STATUS[runState(run)],
    meta: [...head, ...rest].filter((part) => part !== null).join(' · '),
    actions: runActions(run),
  };
}

export function groupLine(run: AipRun, group: AipGroup, options: PanelOptions): GroupLine {
  const style = STATUS[group.status];
  const duration = formatDuration(group.durationMs);
  const reason = firstLine(group.reason);
  const base = { slug: group.slug, style, reason: reason || null };
  const actions = paneGroupActions(run, group);
  if (options.compact) {
    const parts = [
      group.slug,
      group.step,
      group.round !== null ? `r${group.round}` : null,
      duration,
    ].filter((part) => part !== null);
    return { ...base, line: `${style.icon} ${parts.join(' · ')}`, details: null, actions };
  }
  const delivery: StatusStyle | null = group.status === 'merged' ? DELIVERY[group.delivery] : null;
  const details = [
    group.step ? `step ${group.step}` : null,
    group.round !== null ? `round ${group.round}` : null,
    duration,
    formatDiff(group.diff),
    delivery ? `${delivery.icon} ${delivery.label}` : null,
  ].filter((part) => part !== null);
  return {
    ...base,
    line: `${style.icon} ${style.label} · ${group.slug}${
      group.title !== group.slug ? ` — ${group.title}` : ''
    }`,
    details: details.join(' · '),
    actions,
  };
}

/**
 * What waits for the user. The questions of the selected run are open, with their
 * answer forms; everything else is a one-line row, at most ATTENTION_SHOWN of them.
 */
export function needsYou(runs: readonly AipRun[], selectedId: string | null): NeedsYou {
  const open: OpenQuestion[] = [];
  const all: NeedRow[] = [];
  const sorted = sortRuns(runs);
  const ordered = [
    ...sorted.filter((run) => run.id === selectedId),
    ...sorted.filter((run) => run.id !== selectedId),
  ];
  for (const run of ordered) {
    for (const group of runGroups(run)) {
      if (ATTENTION.includes(group.status)) {
        const questions = group.questions && group.questions.length > 0 ? group.questions : null;
        if (
          run.id === selectedId &&
          group.status === 'needs_human' &&
          (questions || group.question)
        ) {
          open.push({
            runId: run.id,
            slug: group.slug,
            title: group.title,
            question: group.question,
            questions,
          });
          continue;
        }
        const detail = firstLine(group.status === 'needs_human' ? group.question : group.reason);
        all.push({
          runId: run.id,
          slug: group.slug,
          runLabel: runLabel(run),
          text: detail || STATUS[group.status].label,
          style: STATUS[group.status],
        });
      } else if (group.delivery === 'apply_failed') {
        all.push({
          runId: run.id,
          slug: group.slug,
          runLabel: runLabel(run),
          text: DELIVERY.apply_failed.label,
          style: DELIVERY.apply_failed,
        });
      }
    }
  }
  return {
    open,
    rows: all.slice(0, ATTENTION_SHOWN),
    more: Math.max(0, all.length - ATTENTION_SHOWN),
  };
}

export function panelView(input: PanelInput, options: PanelOptions): PanelView {
  const sorted = sortRuns(input.runs);
  const current = selectedRun(sorted, input.selected);
  const needs = needsYou(sorted, current?.id ?? null);
  const waiting = needs.open.length + needs.rows.length + needs.more;
  const active = activeRuns(sorted).length;
  const summary = ['aip']
    .concat(active > 0 ? [`${active} active`] : [])
    .concat(waiting > 0 ? [`${waiting} ${waiting === 1 ? 'needs' : 'need'} you`] : [])
    .join(' · ');
  const link = connectionLine(input.connection);
  const shown = sorted.slice(0, RUNS_SHOWN);
  return {
    header: { summary, connection: link.style },
    note: link.note,
    result: resultLine(input.action),
    needs,
    runs: shown.map((run, index) => runRow(run, run.id === current?.id, index, options)),
    hiddenRuns: Math.max(0, sorted.length - shown.length),
    empty: sorted.length === 0 && input.connection.mode !== 'missing',
    run: current
      ? {
          ...runHeader(current, options),
          groups: orderGroups(runGroups(current)).map((group) =>
            groupLine(current, group, options),
          ),
        }
      : null,
  };
}
