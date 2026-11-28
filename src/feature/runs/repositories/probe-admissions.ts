import { invalid } from '../../../platform/errors/index.ts';
import type { Database, Row } from '../../../platform/sqlite/index.ts';
import { admissionProblem, inWindow } from '../types/index.ts';
import type { ProbeLimits } from '../types/index.ts';

/** What one reservation takes: an id of the request, the key of the task, the places and the moment. */
export interface ProbeReservation {
  /** The id the reservation is remembered by: the experiment id, or the id of the probe run. */
  id: string;
  /** The root of the chain of probes: the task the places belong to. */
  rootRunId: string;
  /** The places the request takes: one for a single probe, the whole plan for an experiment. */
  runs: number;
  /** The moment of admission: the start of its life in the window. */
  now: number;
}

/**
 * The places of the probe budget that plans and single probes have taken. `reserve` counts the
 * task and the window and writes its row in one transaction, so of two requests for the last
 * place exactly one passes; a refusal writes nothing and names the limit. A place is never
 * returned: the window forgets it after a day, the task keeps it for good. `restore` writes the
 * reservation of a plan admitted before without a check, and a repeated write by the same id
 * changes nothing.
 */
export class ProbeAdmissionRepository {
  private readonly database: Database;
  private readonly limits: ProbeLimits;

  constructor(database: Database, limits: ProbeLimits) {
    this.database = database;
    this.limits = limits;
  }

  /** Takes the places of the task and refuses the whole request when a limit does not hold. */
  reserve(reservation: ProbeReservation): void {
    this.database.transaction(() => {
      const used = this.used(reservation.rootRunId, reservation.now);
      const problem = admissionProblem(
        used.taskRuns,
        used.windowRuns,
        reservation.runs,
        this.limits,
      );
      if (problem !== null) throw invalid('probe.budget', problem);
      this.database
        .prepare(
          'INSERT INTO probe_admissions (id, root_run_id, admitted_at, runs) VALUES (?, ?, ?, ?)',
        )
        .run(reservation.id, reservation.rootRunId, reservation.now, reservation.runs);
    });
  }

  /** Writes the reservation of an admitted plan again; the same id does not count twice. */
  restore(reservation: ProbeReservation): void {
    this.database
      .prepare(
        'INSERT OR IGNORE INTO probe_admissions (id, root_run_id, admitted_at, runs) VALUES (?, ?, ?, ?)',
      )
      .run(reservation.id, reservation.rootRunId, reservation.now, reservation.runs);
  }

  /**
   * The places the task has taken over its whole life and the places the window holds. The SQL
   * cuts the rows the window cannot hold any more; the rule itself is the one in `inWindow`.
   */
  private used(rootRunId: string, now: number): { taskRuns: number; windowRuns: number } {
    const task = this.database
      .prepare('SELECT COALESCE(SUM(runs), 0) AS used FROM probe_admissions WHERE root_run_id = ?')
      .get(rootRunId) as Row;
    const rows = this.database
      .prepare('SELECT admitted_at AS admittedAt, runs FROM probe_admissions WHERE admitted_at > ?')
      .all(now - this.limits.windowMs) as Row[];
    const windowRuns = rows.reduce(
      (total, row) =>
        inWindow(Number(row.admittedAt), now, this.limits.windowMs)
          ? total + Number(row.runs)
          : total,
      0,
    );
    return { taskRuns: Number(task.used), windowRuns };
  }
}
