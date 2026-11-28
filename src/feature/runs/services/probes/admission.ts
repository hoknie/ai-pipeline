import { probeRootOf } from '../../types/index.ts';
import type { ProbeAdmissionRepository } from '../../repositories/index.ts';
import type { RunStates } from '../states.ts';
import type { ProbeExperiment } from '../../types/index.ts';

/** The admissions of the probe budget together with the states that find the root of a chain. */
export interface ProbeAdmissions {
  repository: ProbeAdmissionRepository;
  states: Pick<RunStates, 'lookup'>;
}

/** What the store and the table of runs remember about the probes admitted before this daemon. */
export interface OlderProbes {
  /** Every stored experiment, active or not: its plan took its places. */
  experiments: ProbeExperiment[];
  /** Every run the table of runs names a probe: its id, its main run and the moment of creation. */
  probeRuns: { id: string; probeOf: string; createdAt: number }[];
}

/**
 * Reserves the places of a single probe or of a whole plan, under one id of the request. The key
 * of the task is the root of the chain of probes: a probe of a probe counts for the task of the
 * main run. Refuses the whole request before any side effect when a limit does not hold.
 */
export function reserveProbes(
  admissions: ProbeAdmissions,
  reservation: { id: string; run: string; runs: number; now: number },
): void {
  admissions.repository.reserve({
    id: reservation.id,
    rootRunId: probeRoot(admissions, reservation.run),
    runs: reservation.runs,
    now: reservation.now,
  });
}

/**
 * Restores the reservation of a plan or a probe admitted before: written again without a check of
 * the budget, and the same id does not count twice.
 */
export function restoreProbes(
  admissions: ProbeAdmissions,
  reservation: { id: string; run: string; runs: number; now: number },
): void {
  admissions.repository.restore({
    id: reservation.id,
    rootRunId: probeRoot(admissions, reservation.run),
    runs: reservation.runs,
    now: reservation.now,
  });
}

function probeRoot(admissions: ProbeAdmissions, run: string): string {
  return probeRootOf((probe) => admissions.states.lookup(probe)?.run, run);
}

/**
 * The reservations and the origin of the probes admitted before, before any new request: the
 * plans of the stored experiments are written again by their ids, the members of their runs are
 * named probes to the journal, and every run the table of runs names a probe takes its place.
 * The same ids write nothing twice, so a restart changes nothing.
 */
export function restoreActive(
  admissions: ProbeAdmissions,
  older: OlderProbes,
  markProbes: (runIds: string[]) => void,
): void {
  for (const experiment of older.experiments) {
    restoreProbes(admissions, {
      id: experiment.id,
      run: experiment.sourceRun,
      runs: experiment.planned,
      now: experiment.createdAt,
    });
  }
  const members = older.experiments.flatMap((experiment) =>
    experiment.runs.map((run) => run.runId),
  );
  if (members.length > 0) markProbes(members);
  for (const probe of older.probeRuns) {
    // A member of a stored experiment is covered by the reservation of the experiment itself;
    // the restore counts the single probes and the runs whose experiment is no longer stored.
    if (members.includes(probe.id)) continue;
    restoreProbes(admissions, { id: probe.id, run: probe.probeOf, runs: 1, now: probe.createdAt });
  }
}
