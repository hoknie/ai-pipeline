import { stepSpecialist } from '../../../swarm-config/types/index.ts';
import { addUsage, type Denial, type Usage, type Verdict } from '../../../agents/types/index.ts';
import type { Attempt } from '../attempt.ts';
import { stepsOf, type Group } from '../group.ts';
import type { RunState } from '../run.ts';

/** How often a pattern was seen, on which tasks, and when it was seen last. */
export interface TaskCount {
  /** How many times the pattern occurred. */
  count: number;
  /** Task numbers (runs) that showed the pattern, without repeats, in the order seen. */
  tasks: number[];
  /** The latest moment the pattern was seen (ms); 0 when unknown. */
  seenAt: number;
}

/** A path and how many times it was seen. */
export interface FileCount {
  path: string;
  count: number;
}

/** The results of the specialist a review rejected, and how long the review loop lasted. */
export interface RejectedSignal extends TaskCount {
  /**
   * The review rounds that ended with a rejection, counted once per task: two steps rejected in the
   * same round of one task are one round. A rejection starts the next round, so this is how many
   * rounds the work was redone in.
   */
  rounds: number;
}

/** Tool calls the agent CLI refused, grouped by the tool. */
export interface DenialSignal extends TaskCount {
  tool: string;
  /** Example commands, without repeats; at most three. */
  commands: string[];
}

/** Files an attempt changed outside its worktree. */
export interface OutsideSignal extends TaskCount {
  /** Example paths, without repeats; at most five. */
  paths: string[];
}

/** A failed delivery of a group, grouped by the state of the delivery. */
export interface DeliverySignal extends TaskCount {
  state: 'apply_failed' | 'push_failed';
  /** The reasons of the deliveries, without repeats; at most three. */
  reasons: string[];
  /** Conflicting files with how often they conflicted, the most frequent first; at most five. */
  conflicts: FileCount[];
  /** Files committed with uncommitted edits of the user, the most frequent first; at most five. */
  userEdits: FileCount[];
}

/** What the finished runs of a repository say about one specialist. */
export interface SpecialistSignal {
  specialist: string;
  attempts: number;
  /**
   * Tokens the attempts of the specialist spent; null when none recorded usage. The attempt keeps
   * them itself, and the usage journal copies the same numbers, so the signal needs no stats table.
   */
  usage: Usage | null;
  verdicts: { done: number; rejected: number; needs_human: number; failed: number };
  /** The tasks a review rejected and sent back to this specialist, with the moment of the last one. */
  rejected: RejectedSignal;
  denials: DenialSignal[];
  outside: OutsideSignal | null;
  deliveries: DeliverySignal[];
}

/** The signal of a specialist without any finished attempt. */
export function emptySignal(specialist: string): SpecialistSignal {
  return {
    specialist,
    attempts: 0,
    usage: null,
    verdicts: { done: 0, rejected: 0, needs_human: 0, failed: 0 },
    rejected: { count: 0, tasks: [], seenAt: 0, rounds: 0 },
    denials: [],
    outside: null,
    deliveries: [],
  };
}

/** One failed-delivery state while the runs are read: its counts and the files it touched. */
interface DeliveryAggregate {
  signal: DeliverySignal;
  conflicts: Map<string, number>;
  userEdits: Map<string, number>;
}

interface Collector {
  denials: Map<string, DenialSignal>;
  deliveries: Map<string, DeliveryAggregate>;
  outside: OutsideSignal;
  /** `<task>/<round>` of every rejection: the rounds the review loop lasted, once per task. */
  rejectedRounds: Set<string>;
}

/**
 * Aggregates the objective outcome of finished runs for one specialist: verdicts, tokens, refused
 * tool calls, changes outside the worktree, failed deliveries and the files they touched. Only
 * finished runs count, and only their work groups: probes and service groups (split, message,
 * resolve, repair) and actions say nothing about the quality of the specialist's own work.
 */
export function collectSignal(runs: readonly RunState[], specialist: string): SpecialistSignal {
  const signal = emptySignal(specialist);
  const collector: Collector = {
    denials: new Map(),
    deliveries: new Map(),
    outside: { count: 0, tasks: [], seenAt: 0, paths: [] },
    rejectedRounds: new Set(),
  };
  for (const state of runs) {
    if (state.run.finishedAt === null) continue;
    for (const group of state.groups) {
      collectGroup(signal, collector, state, group, specialist);
    }
  }
  signal.rejected.rounds = collector.rejectedRounds.size;
  signal.denials = [...collector.denials.values()].sort(byCount);
  signal.deliveries = [...collector.deliveries.values()].map(finishDelivery).sort(byCount);
  signal.outside = collector.outside.count === 0 ? null : collector.outside;
  return signal;
}

function byCount(left: TaskCount & { tool?: string }, right: TaskCount & { tool?: string }) {
  return right.count - left.count || (left.tool ?? '').localeCompare(right.tool ?? '');
}

function collectGroup(
  signal: SpecialistSignal,
  collector: Collector,
  state: RunState,
  group: Group,
  specialist: string,
): void {
  const task = state.run.number;
  // A review rejects the work; the lesson belongs to the specialist the review sends it back to.
  collectRejected(signal, collector, state, group, specialist);
  const own = group.attempts.filter(
    (attempt) => attempt.specialist === specialist && attempt.runtime !== 'command',
  );
  if (own.length === 0) return;
  for (const attempt of own) {
    collectAttempt(signal, collector, attempt, task, state.run.finishedAt ?? 0);
  }
  collectDelivery(collector, group, task, state.run.finishedAt ?? 0);
}

/**
 * The rejected results of a work group, attributed to the author: the specialist of the step that
 * `onReject` sends the work back to, not the reviewer that reported the rejection.
 */
function collectRejected(
  signal: SpecialistSignal,
  collector: Collector,
  state: RunState,
  group: Group,
  specialist: string,
): void {
  let steps: ReturnType<typeof stepsOf>;
  try {
    steps = stepsOf(state.run, group);
  } catch {
    // A configuration this old run cannot describe is no reason to lose the rest of the signal.
    return;
  }
  for (const attempt of group.attempts) {
    if (attempt.status !== 'finished' || attempt.report?.verdict !== 'rejected') continue;
    const goto = steps.find((step) => step.id === steps[attempt.stepIndex]?.onReject?.goto);
    if (!goto || stepSpecialist(state.run.config, goto)?.slug !== specialist) continue;
    addCount(signal.rejected, state.run.number, attempt.finishedAt ?? state.run.finishedAt ?? 0);
    collector.rejectedRounds.add(`${state.run.number}/${attempt.round}`);
  }
}

function collectAttempt(
  signal: SpecialistSignal,
  collector: Collector,
  attempt: Attempt,
  task: number,
  finishedAt: number,
): void {
  signal.attempts += 1;
  signal.usage = addUsage(signal.usage, attempt.usage);
  const at = attempt.finishedAt ?? finishedAt;
  if (attempt.status === 'finished' && attempt.report !== null) {
    countVerdict(signal, attempt.report.verdict);
  } else if (attempt.status !== 'cancelled') {
    // A cancelled attempt (a human message, a pause, a skip) is not an outcome of the specialist.
    signal.verdicts.failed += 1;
  }
  for (const denial of attempt.denials) addDenial(collector.denials, denial, task, at);
  for (const path of attempt.outsideChanges) addOutside(collector.outside, path, task, at);
}

function countVerdict(signal: SpecialistSignal, verdict: Verdict): void {
  if (verdict === 'done') signal.verdicts.done += 1;
  else if (verdict === 'needs_human') signal.verdicts.needs_human += 1;
  // The specialist reported `rejected`; the attributed lesson is counted by `collectRejected`.
  else signal.verdicts.rejected += 1;
}

function addCount(target: TaskCount, task: number, at: number): void {
  target.count += 1;
  if (!target.tasks.includes(task)) target.tasks.push(task);
  target.seenAt = Math.max(target.seenAt, at);
}

function addDenial(
  denials: Map<string, DenialSignal>,
  denial: Denial,
  task: number,
  at: number,
): void {
  const found = denials.get(denial.tool) ?? {
    tool: denial.tool,
    count: 0,
    tasks: [],
    seenAt: 0,
    commands: [],
  };
  addCount(found, task, at);
  const command = denial.command?.trim() ?? '';
  if (command !== '' && !found.commands.includes(command) && found.commands.length < 3) {
    found.commands.push(command);
  }
  denials.set(denial.tool, found);
}

function addOutside(outside: OutsideSignal, path: string, task: number, at: number): void {
  addCount(outside, task, at);
  if (!outside.paths.includes(path) && outside.paths.length < 5) outside.paths.push(path);
}

function collectDelivery(
  collector: Collector,
  group: Group,
  task: number,
  finishedAt: number,
): void {
  const { delivery } = group;
  if (delivery.state !== 'apply_failed' && delivery.state !== 'push_failed') return;
  const found = collector.deliveries.get(delivery.state) ?? newDelivery(delivery.state);
  addCount(found.signal, task, delivery.finishedAt ?? finishedAt);
  const reason = delivery.reason?.trim() ?? '';
  if (reason !== '' && !found.signal.reasons.includes(reason) && found.signal.reasons.length < 3) {
    found.signal.reasons.push(reason);
  }
  countFiles(found.conflicts, delivery.conflicts);
  countFiles(found.userEdits, delivery.userEdits);
  collector.deliveries.set(delivery.state, found);
}

function newDelivery(state: DeliverySignal['state']): DeliveryAggregate {
  return {
    signal: { state, count: 0, tasks: [], seenAt: 0, reasons: [], conflicts: [], userEdits: [] },
    conflicts: new Map(),
    userEdits: new Map(),
  };
}

function countFiles(target: Map<string, number>, paths: readonly string[]): void {
  for (const path of paths) target.set(path, (target.get(path) ?? 0) + 1);
}

function finishDelivery(aggregate: DeliveryAggregate): DeliverySignal {
  return {
    ...aggregate.signal,
    conflicts: topFiles(aggregate.conflicts),
    userEdits: topFiles(aggregate.userEdits),
  };
}

/** The most frequent paths first, at most five: a long delivery must not flood the signal. */
function topFiles(counts: Map<string, number>): FileCount[] {
  return [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path))
    .slice(0, 5);
}
