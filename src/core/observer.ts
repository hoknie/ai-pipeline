import { runProblems, type Problem } from './queue.ts';
import {
  REPAIR_GROUP,
  findGroup,
  freshPending,
  newGroup,
  type Group,
  type Incident,
  type IncidentKind,
  type RunState,
} from './model.ts';

export const OBSERVER_WORKERS_MAX = 20;
export const OBSERVER_REPAIRS_MAX = 50;
/** The runtime whose usage limit holds repairs when the profile names none. */
const DEFAULT_OBSERVER_RUNTIME = 'claude';
/** Position of the repair group among the groups of a run. */
const REPAIR_POSITION = 1_000_002;

export interface ObserverProject {
  repository: string;
  /** `null`: the project has no limit of its own. */
  maxWorkers: number | null;
}

/** Settings of the observers; one set per daemon. */
export interface ObserverSettings {
  enabled: boolean;
  workers: number;
  maxRepairs: number;
  answerHumanOnly: boolean;
  projects: ObserverProject[];
  /** YAML fields of the specialist: name, model, runtime, permissions, timeout, tools, prompt, … */
  specialist: Record<string, unknown>;
}

export function defaultObserverSettings(): ObserverSettings {
  return {
    enabled: false,
    workers: 1,
    maxRepairs: 5,
    answerHumanOnly: false,
    projects: [],
    specialist: {},
  };
}

const KINDS: Partial<Record<Problem['reason'], IncidentKind>> = {
  needs_human: 'question',
  failed: 'failed',
  conflict: 'conflict',
  apply_failed: 'delivery',
};

function detailOf(group: Group, kind: IncidentKind): string {
  switch (kind) {
    case 'question':
      return group.question ?? '';
    case 'delivery':
      return group.delivery.reason ?? '';
    default:
      return group.reason ?? '';
  }
}

/**
 * Incidents of a task an observer may repair: the problems of the run without the ones a person
 * caused (`cancelled`) or time solves (`usage_limit`), without questions for a person only unless
 * `answerHumanOnly` is set, and without the incidents the observer already reported on.
 */
export function repairIncidents(state: RunState, settings: ObserverSettings): Incident[] {
  const taken = new Set(state.run.repair.taken);
  const incidents: Incident[] = [];
  for (const problem of runProblems(state)) {
    const kind = KINDS[problem.reason];
    if (kind === undefined || problem.group === null || taken.has(problem.key)) continue;
    const group = findGroup(state, problem.group);
    if (!group) continue;
    if (kind === 'question' && group.humanOnly !== null && !settings.answerHumanOnly) continue;
    incidents.push({ key: problem.key, kind, group: group.slug, detail: detailOf(group, kind) });
  }
  return incidents;
}

/**
 * Whether an observer may take the incidents of a task: observers are on, the project is
 * connected, the task is not forbidden to them, it has no hold and its repairs are not used up.
 */
export function repairAdmitted(state: RunState, settings: ObserverSettings): boolean {
  const { run } = state;
  return (
    settings.enabled &&
    settings.projects.some((project) => project.repository === run.repository) &&
    run.repair.allowed &&
    run.hold === null &&
    run.repair.repairs < settings.maxRepairs
  );
}

/** When the state of an incident began (ms); the older an incident, the sooner it is repaired. */
function incidentSince(state: RunState, incident: Incident): number {
  const group = findGroup(state, incident.group);
  const ended = group?.attempts.at(-1)?.finishedAt ?? null;
  const since = incident.kind === 'delivery' ? (group?.delivery.finishedAt ?? ended) : ended;
  return since ?? state.run.createdAt;
}

export interface RepairStart {
  state: RunState;
  incident: Incident;
}

/**
 * The tasks whose incident an observer takes now. `holds` maps runtimes held by a usage limit to
 * the moment it resets; the repairs running now count against `workers` and `maxWorkers`, a task
 * has one repair at a time, and the oldest incidents go first.
 */
export function planRepairs(
  settings: ObserverSettings,
  states: Iterable<RunState>,
  holds: ReadonlyMap<string, number>,
): RepairStart[] {
  if (!settings.enabled) return [];
  const runtime =
    typeof settings.specialist.runtime === 'string'
      ? settings.specialist.runtime
      : DEFAULT_OBSERVER_RUNTIME;
  if (holds.has(runtime)) return [];
  const all = [...states];
  let running = 0;
  const byProject = new Map<string, number>();
  for (const state of all) {
    if (state.run.repair.incident === null) continue;
    running += 1;
    byProject.set(state.run.repository, (byProject.get(state.run.repository) ?? 0) + 1);
  }
  const candidates: (RepairStart & { since: number })[] = [];
  for (const state of all) {
    if (state.run.repair.incident !== null || !repairAdmitted(state, settings)) continue;
    const found = repairIncidents(state, settings)
      // Another delivery of the task goes on: its refusal is not a state to repair yet.
      .filter((incident) => incident.kind !== 'delivery' || state.run.pendingDelivery === null)
      .map((incident) => ({ incident, since: incidentSince(state, incident) }))
      .sort((left, right) => left.since - right.since)[0];
    if (found) candidates.push({ state, ...found });
  }
  candidates.sort(
    (left, right) =>
      left.since - right.since || left.state.run.id.localeCompare(right.state.run.id),
  );
  const starts: RepairStart[] = [];
  for (const { state, incident } of candidates) {
    if (running >= settings.workers) break;
    const repository = state.run.repository;
    const limit = settings.projects.find(
      (project) => project.repository === repository,
    )?.maxWorkers;
    if (limit !== null && limit !== undefined && (byProject.get(repository) ?? 0) >= limit)
      continue;
    starts.push({ state, incident });
    running += 1;
    byProject.set(repository, (byProject.get(repository) ?? 0) + 1);
  }
  return starts;
}

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
