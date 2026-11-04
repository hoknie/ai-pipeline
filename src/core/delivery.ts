import { Rejection } from './errors.ts';
import {
  MESSAGE_GROUP,
  RESOLVE_GROUP,
  freshPending,
  newGroup,
  type Group,
  type GroupDelivery,
  type PendingDelivery,
  type RunState,
} from './model.ts';

export type DeliveryEffect =
  | {
      kind: 'deliver';
      run: string;
      groups: string[];
      force: boolean;
      message: string;
      auto: boolean;
    }
  | { kind: 'cleanup'; run: string }
  | { kind: 'prepare_resolve'; run: string; groups: string[]; round: number }
  | { kind: 'finish_resolve'; run: string; groups: string[]; message: string; conflicts: string[] };

export interface DeliveryRequest {
  groups: string[] | null;
  force: boolean;
  files: string[];
  auto: boolean;
}

export type DeliveryResult =
  | {
      kind: 'applied';
      files: string[];
      conflicts: string[];
      commit: string | null;
      userEdits?: string[];
    }
  | { kind: 'refused'; reason: string; files: string[]; conflict?: boolean }
  | { kind: 'failed'; message: string };

function deliverable(group: Group): boolean {
  return group.status === 'merged' && group.delivery.state !== 'applied';
}

export function selectGroups(state: RunState, requested: string[] | null): Group[] {
  if (state.run.refStyle === 'branches') {
    throw new Rejection(
      `run ${state.run.id} keeps its result on branch ${state.run.branch}; merge it with \`git merge ${state.run.branch}\``,
    );
  }
  if (requested === null || requested.length === 0) {
    const groups = state.groups.filter(deliverable);
    if (groups.length === 0)
      throw new Rejection('nothing to deliver: no merged groups are waiting');
    return groups;
  }
  return requested.map((slug) => {
    const group = state.groups.find((candidate) => candidate.slug === slug);
    if (!group) throw new Rejection(`unknown group \`${slug}\``);
    if (group.delivery.state === 'applied')
      throw new Rejection(`group \`${slug}\` is already delivered`);
    if (group.status !== 'merged') {
      throw new Rejection(
        `group \`${slug}\` is ${group.status}; only merged groups can be delivered`,
      );
    }
    return group;
  });
}

function lastSummary(group: Group): string {
  const finished = group.attempts.filter(
    (attempt) => attempt.status === 'finished' && attempt.report,
  );
  return finished.at(-1)?.report?.summary.split('\n')[0]?.trim() ?? '';
}

function title(state: RunState, groups: Group[]): string {
  if (groups.length === 1 && groups[0]) return groups[0].title;
  const task = state.split?.task.split('\n')[0]?.trim();
  if (task) return task.slice(0, 72);
  return `${groups.length} groups: ${groups.map((group) => group.title).join(', ')}`.slice(0, 72);
}

function task(state: RunState, groups: Group[]): string {
  if (state.split) return state.split.task;
  return groups.map((group) => group.task).join('\n\n');
}

export function renderCommitMessage(template: string, state: RunState, groups: Group[]): string {
  const values: Record<string, string> = {
    title: title(state, groups),
    task: task(state, groups),
    run: state.run.id,
    workflow: state.run.workflow,
    groups: groups.map((group) => `- ${group.title}: ${lastSummary(group)}`).join('\n'),
  };
  const text = template.replace(
    /\{(title|task|run|workflow|groups)\}/g,
    (_, key: string) => values[key] ?? '',
  );
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function messageTask(state: RunState, groups: Group[], files: string[]): string {
  return [
    `Write a git commit message for the changes of run ${state.run.id}. The first line is a short subject; then a blank line and a body.`,
    `Report the full message as the summary of swarm_report with verdict "done". Do not change any files.`,
    `Task:\n${task(state, groups)}`,
    `Groups:\n${groups.map((group) => `- ${group.title}: ${lastSummary(group)}`).join('\n')}`,
    `Changed files:\n${files.map((file) => `- ${file}`).join('\n') || '- (none)'}`,
  ].join('\n\n');
}

export function requestDelivery(state: RunState, request: DeliveryRequest): DeliveryEffect[] {
  if (state.run.pendingDelivery !== null) {
    throw new Rejection(`a delivery of run ${state.run.id} is already in progress`);
  }
  const groups = selectGroups(state, request.groups);
  const slugs = groups.map((group) => group.slug);
  state.run.pendingDelivery = { groups: slugs, force: request.force, auto: request.auto };
  const { delivery } = state.run.config;
  if (delivery.mode === 'commit' && delivery.messageSpecialist) {
    state.message = newGroup(
      MESSAGE_GROUP,
      'commit message',
      messageTask(state, groups, request.files),
      1_000_000,
    );
    return [];
  }
  return [deliverEffect(state, renderCommitMessage(delivery.commitMessage, state, groups))];
}

function deliverEffect(state: RunState, message: string): DeliveryEffect {
  const pending = state.run.pendingDelivery;
  if (!pending) throw new Error('no pending delivery');
  pending.message = message;
  return {
    kind: 'deliver',
    run: state.run.id,
    groups: pending.groups,
    force: pending.force,
    message,
    auto: pending.auto,
  };
}

export function finishMessage(state: RunState, summary: string | null): DeliveryEffect[] {
  const pending = state.run.pendingDelivery;
  if (!pending) return [];
  const groups = state.groups.filter((group) => pending.groups.includes(group.slug));
  const message = summary?.trim()
    ? summary.trim()
    : renderCommitMessage(state.run.config.delivery.commitMessage, state, groups);
  return [deliverEffect(state, message)];
}

export function cancelDelivery(state: RunState): void {
  state.run.pendingDelivery = null;
}

function shouldResolve(state: RunState, pending: PendingDelivery, result: DeliveryResult): boolean {
  const { resolver, resolverRounds } = state.run.config.delivery;
  if (!resolver || pending.force || result.kind === 'applied') return false;
  const round = pending.round ?? 0;
  if (round >= resolverRounds) return false;
  return round > 0 || (result.kind === 'refused' && result.conflict === true);
}

function resolveTask(state: RunState, groups: Group[], conflicts: string[]): string {
  return [
    `Your working directory holds the user's current working tree with the changes of run ${state.run.id} applied on top. The files below contain git conflict markers (<<<<<<<, =======, >>>>>>>) where the changes of the run and the user's own edits collide.`,
    'Resolve every conflict so that both the edits of the user and the intent of the run are kept. Remove every conflict marker, run the checks of the project if you can, and report done. Report rejected if the conflicts cannot be resolved safely.',
    'Run the checks in the foreground and wait for their result in the same shell command, with a timeout long enough for the whole check (up to 10 minutes). Never start them in the background and never wait for them with `pgrep`, `pkill` or `sleep` loops: the name of the check command also appears in the command lines of other agents and of your own shell, so such a wait never ends.',
    `Conflicting files:\n${conflicts.map((file) => `- ${file}`).join('\n')}`,
    `Task of the run:\n${task(state, groups)}`,
    `Groups:\n${groups.map((group) => `- ${group.title}: ${lastSummary(group)}`).join('\n')}`,
  ].join('\n\n');
}

/** The resolver worktree is ready; `conflicts` lists the files with conflict markers. */
export function resolvePrepared(state: RunState, conflicts: string[]): DeliveryEffect[] {
  const pending = state.run.pendingDelivery;
  if (!pending) return [];
  pending.conflicts = conflicts;
  if (conflicts.length === 0) return [finishResolveEffect(state, pending)];
  const groups = state.groups.filter((group) => pending.groups.includes(group.slug));
  const text = resolveTask(state, groups, conflicts);
  if (state.resolve === null) {
    state.resolve = newGroup(RESOLVE_GROUP, 'resolve delivery conflicts', text, 1_000_001);
  } else {
    state.resolve.task = text;
    state.resolve.status = 'queued';
    state.resolve.pending = freshPending(0);
    state.resolve.reason = null;
    state.resolve.question = null;
  }
  return [];
}

function finishResolveEffect(state: RunState, pending: PendingDelivery): DeliveryEffect {
  return {
    kind: 'finish_resolve',
    run: state.run.id,
    groups: pending.groups,
    message: pending.message ?? '',
    conflicts: pending.conflicts ?? [],
  };
}

/** The resolver reported done: commit its worktree and deliver the result. */
export function resolverDone(state: RunState): DeliveryEffect[] {
  const pending = state.run.pendingDelivery;
  return pending ? [finishResolveEffect(state, pending)] : [];
}

export function finishDelivery(
  state: RunState,
  result: DeliveryResult,
  now: number,
): DeliveryEffect[] {
  const pending = state.run.pendingDelivery;
  if (!pending) return [];
  if (shouldResolve(state, pending, result)) {
    pending.round = (pending.round ?? 0) + 1;
    if (result.kind === 'refused' && result.files.length > 0) pending.conflicts = result.files;
    return [
      { kind: 'prepare_resolve', run: state.run.id, groups: pending.groups, round: pending.round },
    ];
  }
  state.run.pendingDelivery = null;
  const outcome =
    result.kind === 'failed' && (pending.round ?? 0) > 0
      ? { kind: 'refused' as const, reason: result.message, files: pending.conflicts ?? [] }
      : result;
  for (const group of state.groups.filter((candidate) => pending.groups.includes(candidate.slug))) {
    group.delivery = deliveryOf(outcome, now);
  }
  const merged = state.groups.filter((group) => group.status === 'merged');
  const everything =
    merged.length > 0 && merged.every((group) => group.delivery.state === 'applied');
  const settled = state.groups.every((group) =>
    ['merged', 'failed', 'cancelled'].includes(group.status),
  );
  if (everything && settled && !state.run.config.delivery.keep)
    return [{ kind: 'cleanup', run: state.run.id }];
  return [];
}

function deliveryOf(result: DeliveryResult, now: number): GroupDelivery {
  switch (result.kind) {
    case 'applied':
      return {
        state: 'applied',
        reason: null,
        files: result.files,
        conflicts: result.conflicts,
        userEdits: result.userEdits ?? [],
        finishedAt: now,
      };
    case 'refused':
      return {
        state: 'apply_failed',
        reason: result.reason,
        files: result.files,
        conflicts: [],
        userEdits: [],
        finishedAt: now,
      };
    case 'failed':
      return {
        state: 'apply_failed',
        reason: result.message,
        files: [],
        conflicts: [],
        userEdits: [],
        finishedAt: now,
      };
  }
}

export function deliveryCounts(state: RunState): {
  applied: number;
  merged: number;
  failed: number;
} {
  const merged = state.groups.filter((group) => group.status === 'merged');
  return {
    applied: merged.filter((group) => group.delivery.state === 'applied').length,
    merged: merged.length,
    failed: merged.filter((group) => group.delivery.state === 'apply_failed').length,
  };
}
