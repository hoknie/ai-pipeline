import { rejected } from '../../../platform/errors/index.ts';
import type { Specialist } from '../../swarm-config/types/index.ts';
import {
  type Incident,
  type RunState,
  REPAIR_GROUP,
  freshPending,
  isTerminal,
  newGroup,
  runProblems,
} from '../types/index.ts';
import type { Ctx } from './events.ts';
import { renderCommitMessage } from './texts.ts';

/** Position of the repair group among the groups of a run. */
const REPAIR_POSITION = 1_000_002;

const RULES = [
  'You are an observer: you repair one task without a person. Work only on this task.',
  'Tools: swarm_repair_answer { group, answer } answers a question of a group; swarm_repair_retry { group, refresh_config? } restarts a failed or conflicted group; swarm_repair_cancel { group?, reason } cancels a group, or the whole task without `group`, and the reason stays visible in the task.',
  'You cannot touch other tasks, the queue or the settings. A question marked for a person only is answered by you only when it is part of your incident.',
  'Finish with swarm_report: done when the incident is dealt with; rejected or needs_human when a person must take over — the incident then stays with the person.',
];

function groupsText(state: RunState): string {
  const lines = state.groups.map((group) => {
    const delivery = group.status === 'merged' ? `, delivery ${group.delivery.state}` : '';
    return `- ${group.slug} (${group.title}): ${group.status}${delivery}`;
  });
  return lines.join('\n') || '- (none)';
}

/** The task of the observer: the incident, the state of the task and the rules. */
export function repairTask(
  state: RunState,
  incident: Incident,
  extra: { conflicts?: string[] } = {},
): string {
  const parts = [
    ...RULES,
    `Task ${state.run.id}${state.run.title ? ` — ${state.run.title}` : ''}.`,
    `Incident: ${incident.kind} in group \`${incident.group}\`.\n${incident.detail}`.trim(),
    `Groups:\n${groupsText(state)}`,
  ];
  if (incident.kind === 'delivery') {
    parts.push(
      "Your working directory holds the user's current working tree with the changes of the task applied on top. Resolve every git conflict marker (<<<<<<<, =======, >>>>>>>), keeping both the edits of the user and the intent of the task, then report done. Delivery runs afterwards without force; leftover markers make it fail.",
    );
    if (extra.conflicts && extra.conflicts.length > 0) {
      parts.push(`Conflicting files:\n${extra.conflicts.map((file) => `- ${file}`).join('\n')}`);
    }
  }
  return parts.join('\n\n');
}

/** A new attempt of the repair group: creates the group or queues the existing one again. */
export function openRepairGroup(state: RunState, task: string): void {
  if (state.repair === null) {
    state.repair = newGroup(REPAIR_GROUP, 'repair', task, REPAIR_POSITION);
    return;
  }
  state.repair.task = task;
  state.repair.status = 'queued';
  state.repair.pending = freshPending(0);
  state.repair.reason = null;
  state.repair.question = null;
  state.repair.questions = null;
  state.repair.humanOnly = null;
}

/** Keys of the `apply_failed` incidents of the groups of a delivery. */
export function deliveryKeys(state: RunState, groups: readonly string[]): string[] {
  return runProblems(state)
    .filter(
      (problem) =>
        problem.reason === 'apply_failed' &&
        problem.group !== null &&
        groups.includes(problem.group),
    )
    .map((problem) => problem.key);
}

/**
 * The only way out of a repair: clears the incident and the profile, drops the delivery the repair
 * started, adds `taken` to the incidents already reported on and, with `refund`, gives the repair
 * back.
 */
export function closeRepair(
  state: RunState,
  options: { taken: readonly string[]; refund: boolean },
): void {
  const { repair } = state.run;
  if (options.refund && repair.repairs > 0) repair.repairs -= 1;
  for (const key of options.taken) {
    if (!repair.taken.includes(key)) repair.taken.push(key);
  }
  repair.incident = null;
  repair.specialist = null;
  if (state.run.pendingDelivery?.repair) state.run.pendingDelivery = null;
}

export function repairStart(m: Ctx, incident: Incident, specialist: Specialist): void {
  const { run } = m.state;
  if (run.repair.incident !== null) throw rejected('a repair of this run is already going');
  if (run.hold !== null) throw rejected(`run is ${run.hold}; observers do not take it`);
  if (incident.kind === 'delivery') {
    if (run.pendingDelivery !== null) {
      throw rejected(`a delivery of run ${run.id} is already in progress`);
    }
    const groups = m.state.groups.filter(
      (group) => group.status === 'merged' && group.delivery.state === 'apply_failed',
    );
    if (groups.length === 0) throw rejected('no delivery to repair');
    run.repair.incident = incident;
    run.repair.specialist = specialist;
    run.repair.repairs += 1;
    run.pendingDelivery = {
      groups: groups.map((group) => group.slug),
      force: false,
      auto: false,
      round: 1,
      repair: true,
      message: renderCommitMessage(run.config.delivery.commitMessage, m.state, groups),
    };
    m.effects.push({
      kind: 'prepare_resolve',
      run: run.id,
      groups: run.pendingDelivery.groups,
      round: 1,
    });
    return;
  }
  run.repair.incident = incident;
  run.repair.specialist = specialist;
  run.repair.repairs += 1;
  openRepairGroup(m.state, repairTask(m.state, incident));
}

export function repairAllowed(m: Ctx, allowed: boolean): void {
  const { repair } = m.state.run;
  if (allowed === repair.allowed) return;
  repair.allowed = allowed;
  if (!allowed) {
    stopRepair(m, { reason: null, refund: false });
    return;
  }
  // Returning the task to observers starts its count again.
  repair.repairs = 0;
  repair.taken = [];
}

/**
 * Ends the repair that goes on: the agent stops, the group is cancelled with `reason` and the
 * incident is released. Nothing happens when no repair goes on.
 */
export function stopRepair(m: Ctx, options: { reason: string | null; refund: boolean }): void {
  if (m.state.run.repair.incident === null) return;
  if (options.reason === 'paused') m.pausedRepair = true;
  const group = m.state.repair;
  if (group && !isTerminal(group.status)) {
    group.status = 'cancelled';
    group.pending = null;
    if (options.reason !== null) group.reason = options.reason;
    for (const attempt of group.attempts) {
      if (attempt.status !== 'running') continue;
      attempt.status = 'cancelled';
      attempt.finishedAt = m.now;
      m.effects.push({
        kind: 'stop_attempt',
        run: m.state.run.id,
        group: group.slug,
        seq: attempt.seq,
      });
    }
  }
  closeRepair(m.state, { taken: [], refund: options.refund });
}
