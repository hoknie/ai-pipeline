import { stepSpecialist } from '../../../swarm-config/types/index.ts';
import type { Denial, Verdict } from '../../../agents/types/index.ts';
import type { Attempt } from '../attempt.ts';
import { stepsOf, type Group } from '../group.ts';
import { allGroups, type RunState } from '../run.ts';

/** How often a pattern was seen, on which tasks, and when it was seen last. */
export interface TaskCount {
  /** How many times the pattern occurred. */
  count: number;
  /** Task numbers (runs) that showed the pattern, without repeats, in the order seen. */
  tasks: number[];
  /** The latest moment the pattern was seen (ms); 0 when unknown. */
  seenAt: number;
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
  /** Conflicting files, without repeats; at most five. */
  conflicts: string[];
}

/** What the finished runs of a repository say about one specialist. */
export interface SpecialistSignal {
  specialist: string;
  attempts: number;
  verdicts: { done: number; rejected: number; needs_human: number; failed: number };
  /** The tasks a review rejected and sent back to this specialist, with the moment of the last one. */
  rejected: TaskCount;
  denials: DenialSignal[];
  outside: OutsideSignal | null;
  deliveries: DeliverySignal[];
}

/** The signal of a specialist without any finished attempt. */
export function emptySignal(specialist: string): SpecialistSignal {
  return {
    specialist,
    attempts: 0,
    verdicts: { done: 0, rejected: 0, needs_human: 0, failed: 0 },
    rejected: { count: 0, tasks: [], seenAt: 0 },
    denials: [],
    outside: null,
    deliveries: [],
  };
}

interface Collector {
  denials: Map<string, DenialSignal>;
  deliveries: Map<string, DeliverySignal>;
  outside: OutsideSignal;
}

/**
 * Aggregates the objective outcome of finished runs for one specialist: verdicts, refused tool
 * calls, changes outside the worktree and failed deliveries. Only finished runs count.
 */
export function collectSignal(runs: readonly RunState[], specialist: string): SpecialistSignal {
  const signal = emptySignal(specialist);
  const collector: Collector = {
    denials: new Map(),
    deliveries: new Map(),
    outside: { count: 0, tasks: [], seenAt: 0, paths: [] },
  };
  for (const state of runs) {
    if (state.run.finishedAt === null) continue;
    for (const group of allGroups(state)) {
      collectGroup(signal, collector, state, group, specialist);
    }
  }
  signal.denials = [...collector.denials.values()].sort(byCount);
  signal.deliveries = [...collector.deliveries.values()].sort(byCount);
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
  collectRejected(signal, state, group, specialist);
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
  state: RunState,
  group: Group,
  specialist: string,
): void {
  if (!state.groups.includes(group)) return;
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
  const found = collector.deliveries.get(delivery.state) ?? {
    state: delivery.state,
    count: 0,
    tasks: [],
    seenAt: 0,
    reasons: [],
    conflicts: [],
  };
  addCount(found, task, delivery.finishedAt ?? finishedAt);
  const reason = delivery.reason?.trim() ?? '';
  if (reason !== '' && !found.reasons.includes(reason) && found.reasons.length < 3) {
    found.reasons.push(reason);
  }
  for (const conflict of delivery.conflicts) {
    if (!found.conflicts.includes(conflict) && found.conflicts.length < 5) {
      found.conflicts.push(conflict);
    }
  }
  collector.deliveries.set(delivery.state, found);
}
