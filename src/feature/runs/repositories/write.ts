import type { Database } from '../../../platform/sqlite/index.ts';
import { json } from '../../../platform/sqlite/index.ts';
import { type Attempt, type Group, type RunState, allGroups } from '../types/index.ts';

function writeRunRow(database: Database, { run }: RunState): void {
  database
    .prepare(
      `INSERT INTO runs (id, repository, pipeline, base_commit, branch, ref_style, created_at, finished_at, config_json, dirty_warning, next_merge_seq, pending_delivery_json, title, name, naming_usage_json, from_queue, tags_json, queue_item, skipped_steps_json, number, hold, repair_json, variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET finished_at = excluded.finished_at, next_merge_seq = excluded.next_merge_seq, pending_delivery_json = excluded.pending_delivery_json, title = excluded.title, name = excluded.name, naming_usage_json = excluded.naming_usage_json, tags_json = excluded.tags_json, skipped_steps_json = excluded.skipped_steps_json, hold = excluded.hold, repair_json = excluded.repair_json, config_json = excluded.config_json`,
    )
    .run(
      run.id,
      run.repository,
      run.pipeline,
      run.baseCommit,
      run.branch,
      run.refStyle,
      run.createdAt,
      run.finishedAt,
      JSON.stringify(run.config),
      run.dirtyWarning ? 1 : 0,
      run.nextMergeSeq,
      json(run.pendingDelivery),
      run.title,
      run.name,
      json(run.namingUsage),
      run.fromQueue ? 1 : 0,
      JSON.stringify(run.tags),
      run.queueItem,
      JSON.stringify(run.skippedSteps),
      run.number,
      run.hold,
      JSON.stringify(run.repair),
      run.variant,
    );
}

function writeGroup(database: Database, runId: string, group: Group): void {
  database
    .prepare(
      `INSERT OR REPLACE INTO groups (run_id, slug, position, title, task, status, pending_json, rejections_json, question, reason, warnings_json, decisions_json, conflict_files_json, merge_seq, merge_in_flight, update_on_conflict, merge_commit, delivery_json, questions_json, human_only)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      group.slug,
      group.position,
      group.title,
      group.task,
      group.status,
      json(group.pending),
      JSON.stringify(group.rejections),
      group.question,
      group.reason,
      JSON.stringify(group.warnings),
      JSON.stringify(group.decisions),
      JSON.stringify(group.conflictFiles),
      group.mergeSeq,
      group.mergeInFlight ? 1 : 0,
      group.updateOnConflict ? 1 : 0,
      group.mergeCommit,
      JSON.stringify(group.delivery),
      json(group.questions),
      group.humanOnly,
    );
}

function writeAttempt(
  database: Database,
  runId: string,
  groupSlug: string,
  attempt: Attempt,
): void {
  database
    .prepare(
      `INSERT OR REPLACE INTO attempts (run_id, group_slug, seq, step_id, step_index, round, specialist, runtime, model, status, input_json, resume_session, session_id, report_json, reason_json, started_at, finished_at, usage_json, proposal_json, denials_json, outside_changes_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      groupSlug,
      attempt.seq,
      attempt.stepId,
      attempt.stepIndex,
      attempt.round,
      attempt.specialist,
      attempt.runtime,
      attempt.model,
      attempt.status,
      JSON.stringify(attempt.input),
      attempt.resumeSession,
      attempt.sessionId,
      json(attempt.report),
      json(attempt.reason),
      attempt.startedAt,
      attempt.finishedAt,
      json(attempt.usage),
      json(attempt.proposal),
      JSON.stringify(attempt.denials),
      JSON.stringify(attempt.outsideChanges),
    );
}

/** Writes the run, its groups and attempts; opens no transaction. */
export function writeRunRows(database: Database, state: RunState): void {
  writeRunRow(database, state);
  for (const group of allGroups(state)) {
    writeGroup(database, state.run.id, group);
    for (const attempt of group.attempts) writeAttempt(database, state.run.id, group.slug, attempt);
  }
}
