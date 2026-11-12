import {
  type Group,
  type Incident,
  type IncidentKind,
  type Problem,
  type RunState,
  allGroups,
  findGroup,
  runProblems,
} from '../../runs/types/index.ts';
import type { ObserverSettings } from './settings.ts';

/** The runtime whose usage limit holds repairs when the profile names none. */
const DEFAULT_OBSERVER_RUNTIME = 'claude';

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

/** Whether the group waits for a person: its question is for a person only and is open. */
export function waitsForPerson(group: Group): boolean {
  return group.status === 'needs_human' && group.humanOnly !== null;
}

/** Open questions for a person only in a task, service groups left out. */
export function personQuestions(state: RunState): Group[] {
  return allGroups(state).filter((group) => group.slug !== '_repair' && waitsForPerson(group));
}

/**
 * Incidents of a task an observer may repair: the problems of the run without the ones a person
 * caused (`cancelled`) or time solves (`usage_limit`), without questions for a person only, and without the incidents the observer already reported on.
 */
export function repairIncidents(state: RunState): Incident[] {
  const taken = new Set(state.run.repair.taken);
  const incidents: Incident[] = [];
  for (const problem of runProblems(state)) {
    const kind = KINDS[problem.reason];
    if (kind === undefined || problem.group === null || taken.has(problem.key)) continue;
    const group = findGroup(state, problem.group);
    if (!group) continue;
    if (kind === 'question' && group.humanOnly !== null) continue;
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
    const found = repairIncidents(state)
      // Another delivery of the task goes on: its refusal is not a state to repair yet.
      .filter((incident) => incident.kind !== 'delivery' || state.run.pendingDelivery === null)
      .map((incident) => ({ incident, since: incidentSince(state, incident) }))
      .sort((left, right) => left.since - right.since)[0];
    if (found) candidates.push({ state, ...found });
  }
  candidates.sort(
    (left, right) =>
      left.since - right.since || left.state.run.id.localeCompare(right.state.run.id, 'en'),
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
