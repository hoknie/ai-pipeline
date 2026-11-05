import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  DELIVERY_MODES,
  withConfigDefaults,
  type ResolvedConfig,
  type Runtime,
} from '../config/index.ts';
import {
  MESSAGE_GROUP,
  ON_LIMIT_MODES,
  RUN_HOLDS,
  RESOLVE_GROUP,
  SPLIT_GROUP,
  allGroups,
  pendingDelivery,
  transition,
  type Attempt,
  type AttemptStatus,
  type Effect,
  type Group,
  type HumanDecision,
  type Queue,
  type QueueItem,
  type GroupStatus,
  type RefStyle,
  type RunState,
  type Tag,
  type TagColor,
} from '../core/index.ts';

import { migrate } from './schema.ts';

type Row = Record<string, SQLInputValue>;

const RECENT_FINISHED = 10;

function json(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parse<T>(value: SQLInputValue): T {
  return JSON.parse(String(value)) as T;
}

function nullable<T>(value: SQLInputValue): T | null {
  return value === null ? null : parse<T>(value);
}

function text(value: SQLInputValue): string | null {
  return value === null ? null : String(value);
}

export type KnownRepository = { path: string; addedAt: number };

/** A run after a daemon restart and the effects the daemon must perform for it. */
export type RecoveredRun = { state: RunState; effects: Effect[] };

/** Where the patch of a run is kept; the bytes live outside the database. */
export interface RunPatchRecord {
  uri: string;
  /** The run ref commit the patch was built from. */
  commit: string;
  size: number;
  createdAt: number;
}

/** A file a specialist published for a group; the bytes live outside the database. */
export interface ArtifactRecord {
  id: string;
  runId: string;
  group: string;
  step: string;
  /** Number of the attempt that published it. */
  seq: number;
  specialist: string;
  title: string;
  fileName: string;
  size: number;
  uri: string;
  createdAt: number;
}

function artifactRecord(row: Row): ArtifactRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    group: String(row.group_slug),
    step: String(row.step_id),
    seq: Number(row.seq),
    specialist: String(row.specialist),
    title: String(row.title),
    fileName: String(row.file_name),
    size: Number(row.size),
    uri: String(row.uri),
    createdAt: Number(row.created_at),
  };
}

export class Store {
  readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    migrate(this.database);
  }

  close(): void {
    this.database.close();
  }

  transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  saveRun(state: RunState): void {
    this.transaction(() => this.writeRun(state));
  }

  private writeRun(state: RunState): void {
    const { run } = state;
    this.database
      .prepare(
        `INSERT INTO runs (id, repository, workflow, base_commit, branch, ref_style, created_at, finished_at, config_json, dirty_warning, next_merge_seq, pending_delivery_json, title, name, naming_usage_json, from_queue, tags_json, queue_item, skipped_steps_json, number, hold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET finished_at = excluded.finished_at, next_merge_seq = excluded.next_merge_seq, pending_delivery_json = excluded.pending_delivery_json, title = excluded.title, name = excluded.name, naming_usage_json = excluded.naming_usage_json, tags_json = excluded.tags_json, skipped_steps_json = excluded.skipped_steps_json, hold = excluded.hold`,
      )
      .run(
        run.id,
        run.repository,
        run.workflow,
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
      );
    const groupStatement = this.database.prepare(
      `INSERT OR REPLACE INTO groups (run_id, slug, position, title, task, status, pending_json, rejections_json, question, reason, warnings_json, decisions_json, conflict_files_json, merge_seq, merge_in_flight, update_on_conflict, merge_commit, delivery_json, questions_json, human_only)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const attemptStatement = this.database.prepare(
      `INSERT OR REPLACE INTO attempts (run_id, group_slug, seq, step_id, step_index, round, specialist, runtime, model, status, input_json, resume_session, session_id, report_json, reason_json, started_at, finished_at, usage_json, proposal_json, denials_json, outside_changes_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const group of allGroups(state)) {
      groupStatement.run(
        run.id,
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
      for (const attempt of group.attempts) {
        attemptStatement.run(
          run.id,
          group.slug,
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
    }
  }

  runPatch(runId: string): RunPatchRecord | null {
    const row = this.database.prepare('SELECT * FROM run_patches WHERE run_id = ?').get(runId) as
      Row | undefined;
    return row
      ? {
          uri: String(row.uri),
          commit: String(row.commit_id),
          size: Number(row.size),
          createdAt: Number(row.created_at),
        }
      : null;
  }

  setRunPatch(runId: string, record: RunPatchRecord): void {
    this.database
      .prepare(
        `INSERT INTO run_patches (run_id, uri, commit_id, size, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (run_id) DO UPDATE SET uri = excluded.uri, commit_id = excluded.commit_id,
           size = excluded.size, created_at = excluded.created_at`,
      )
      .run(runId, record.uri, record.commit, record.size, record.createdAt);
  }

  runPatchIds(): string[] {
    return (this.database.prepare('SELECT run_id FROM run_patches').all() as Row[]).map((row) =>
      String(row.run_id),
    );
  }

  /** The artifact the same attempt already published under that file name, if any. */
  findArtifact(runId: string, group: string, seq: number, fileName: string): ArtifactRecord | null {
    const row = this.database
      .prepare(
        'SELECT * FROM artifacts WHERE run_id = ? AND group_slug = ? AND seq = ? AND file_name = ?',
      )
      .get(runId, group, seq, fileName) as Row | undefined;
    return row ? artifactRecord(row) : null;
  }

  /**
   * Records an artifact; the same attempt publishing the same file name again replaces the
   * earlier record (its `id` stays). Returns the stored record and the URI it replaced.
   */
  addArtifact(record: ArtifactRecord): { artifact: ArtifactRecord; previousUri: string | null } {
    return this.transaction(() => {
      const before = this.findArtifact(record.runId, record.group, record.seq, record.fileName);
      this.database
        .prepare(
          `INSERT INTO artifacts (id, run_id, group_slug, step_id, seq, specialist, title, file_name, size, uri, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (run_id, group_slug, seq, file_name) DO UPDATE SET
             title = excluded.title, size = excluded.size, uri = excluded.uri,
             created_at = excluded.created_at, specialist = excluded.specialist,
             step_id = excluded.step_id`,
        )
        .run(
          record.id,
          record.runId,
          record.group,
          record.step,
          record.seq,
          record.specialist,
          record.title,
          record.fileName,
          record.size,
          record.uri,
          record.createdAt,
        );
      const artifact = this.findArtifact(record.runId, record.group, record.seq, record.fileName);
      return { artifact: artifact!, previousUri: before?.uri ?? null };
    });
  }

  /** Artifacts of a group, newest first. */
  artifacts(runId: string, group: string): ArtifactRecord[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM artifacts WHERE run_id = ? AND group_slug = ? ORDER BY created_at DESC, rowid DESC',
        )
        .all(runId, group) as Row[]
    ).map(artifactRecord);
  }

  artifact(runId: string, id: string): ArtifactRecord | null {
    const row = this.database
      .prepare('SELECT * FROM artifacts WHERE run_id = ? AND id = ?')
      .get(runId, id) as Row | undefined;
    return row ? artifactRecord(row) : null;
  }

  artifactCount(runId: string, group: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS n FROM artifacts WHERE run_id = ? AND group_slug = ?')
      .get(runId, group) as Row;
    return Number(row.n);
  }

  /** Number of artifacts per group of a run. */
  artifactCounts(runId: string): Map<string, { count: number; revision: number }> {
    const rows = this.database
      .prepare(
        'SELECT group_slug, COUNT(*) AS n, MAX(created_at) AS at, SUM(size) AS bytes FROM artifacts WHERE run_id = ? GROUP BY group_slug',
      )
      .all(runId) as Row[];
    return new Map(
      rows.map((row) => [
        String(row.group_slug),
        { count: Number(row.n), revision: Number(row.at) + Number(row.bytes) },
      ]),
    );
  }

  /** URIs of all artifacts by run, for sweeping the storage. */
  artifactUris(): Map<string, string[]> {
    const uris = new Map<string, string[]>();
    for (const row of this.database.prepare('SELECT run_id, uri FROM artifacts').all() as Row[]) {
      const run = String(row.run_id);
      uris.set(run, [...(uris.get(run) ?? []), String(row.uri)]);
    }
    return uris;
  }

  loadRun(id: string): RunState | null {
    const row = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return row ? this.hydrate(row) : null;
  }

  /** The run that started from queue item `item` in the repository, if any. */
  runOfQueueItem(repository: string, item: string): RunState | null {
    const row = this.database
      .prepare('SELECT * FROM runs WHERE repository = ? AND queue_item = ? LIMIT 1')
      .get(repository, item) as Row | undefined;
    return row ? this.hydrate(row) : null;
  }

  activeRuns(): RunState[] {
    const rows = this.database
      .prepare('SELECT * FROM runs WHERE finished_at IS NULL ORDER BY created_at, id')
      .all() as Row[];
    return rows.map((row) => this.hydrate(row));
  }

  finishedRuns(): RunState[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, id DESC',
      )
      .all() as Row[];
    return rows.map((row) => this.hydrate(row));
  }

  recentRuns(limit = RECENT_FINISHED): RunState[] {
    const finished = this.database
      .prepare(
        'SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ?',
      )
      .all(limit) as Row[];
    return [...this.activeRuns(), ...finished.map((row) => this.hydrate(row))];
  }

  /**
   * Marks what the old daemon left running as interrupted: active runs and finished runs whose
   * delivery had not finished. The returned effects (a restarted delivery) are for the daemon.
   */
  recover(now: number): RecoveredRun[] {
    return this.transaction(() => {
      const delivering = this.database
        .prepare(
          'SELECT * FROM runs WHERE finished_at IS NOT NULL AND pending_delivery_json IS NOT NULL ORDER BY created_at, id',
        )
        .all() as Row[];
      const states = [...this.activeRuns(), ...delivering.map((row) => this.hydrate(row))];
      return states.map((state) => {
        const effects = transition(state, { kind: 'interrupted' }, now);
        this.writeRun(state);
        return { state, effects };
      });
    });
  }

  /** Ids of the runs with an attempt that ran out of a usage limit. */
  limitedRunIds(): string[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT run_id FROM attempts WHERE reason_json LIKE '%"usage_limit"%' ORDER BY run_id`,
      )
      .all() as Row[];
    return rows.map((row) => String(row.run_id));
  }

  /** The largest task number of the repository among its runs and queue items; 0 when none. */
  maxTaskNumber(repository: string): number {
    const row = this.database
      .prepare(
        `SELECT MAX(
           (SELECT COALESCE(MAX(number), 0) FROM runs WHERE repository = ?),
           (SELECT COALESCE(MAX(number), 0) FROM queue_items WHERE repository = ?)
         ) AS max`,
      )
      .get(repository, repository) as { max: number };
    return Number(row.max);
  }

  /** The id of the run of the repository with this task number; null when there is none. */
  runIdByNumber(repository: string, number: number): string | null {
    const row = this.database
      .prepare('SELECT id FROM runs WHERE repository = ? AND number = ?')
      .get(repository, number) as { id: string } | undefined;
    return row?.id ?? null;
  }

  loadQueue(repository: string): Queue | null {
    const row = this.database
      .prepare('SELECT * FROM queues WHERE repository = ?')
      .get(repository) as Row | undefined;
    return row ? this.hydrateQueue(row) : null;
  }

  repositories(): KnownRepository[] {
    const rows = this.database
      .prepare('SELECT path, added_at FROM repositories ORDER BY path')
      .all() as { path: string; added_at: number }[];
    return rows.map((row) => ({ path: row.path, addedAt: row.added_at }));
  }

  /** Returns true when the repository was not in the registry yet. */
  addRepository(path: string, now: number): boolean {
    const result = this.database
      .prepare('INSERT OR IGNORE INTO repositories (path, added_at) VALUES (?, ?)')
      .run(path, now);
    return Number(result.changes) > 0;
  }

  removeRepository(path: string): void {
    this.database.prepare('DELETE FROM repositories WHERE path = ?').run(path);
  }

  tags(): Tag[] {
    const rows = this.database
      .prepare(
        'SELECT id, repository, name, color, created_at, task_run, task_number FROM tags ORDER BY created_at, id',
      )
      .all() as {
      id: string;
      repository: string;
      name: string;
      color: string;
      created_at: number;
      task_run: string | null;
      task_number: number | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      repository: row.repository,
      name: row.name,
      color: row.color as TagColor,
      createdAt: row.created_at,
      task:
        row.task_run !== null && row.task_number !== null
          ? { run: row.task_run, number: row.task_number }
          : null,
    }));
  }

  saveTag(tag: Tag): void {
    this.database
      .prepare(
        `INSERT INTO tags (id, repository, name, color, created_at, task_run, task_number) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color`,
      )
      .run(
        tag.id,
        tag.repository,
        tag.name,
        tag.color,
        tag.createdAt,
        tag.task?.run ?? null,
        tag.task?.number ?? null,
      );
  }

  /** Deletes the tag and takes its id off every run and queue item of its repository, in one transaction. */
  removeTag(repository: string, id: string): void {
    this.transaction(() => {
      this.database.prepare('DELETE FROM tags WHERE id = ? AND repository = ?').run(id, repository);
      for (const table of ['runs', 'queue_items']) {
        this.database
          .prepare(
            `UPDATE ${table} SET tags_json = (SELECT json_group_array(value) FROM json_each(tags_json) WHERE value <> ?)
             WHERE repository = ? AND EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value = ?)`,
          )
          .run(id, repository, id);
      }
    });
  }

  queues(): Queue[] {
    const rows = this.database.prepare('SELECT * FROM queues ORDER BY repository').all() as Row[];
    return rows.map((row) => this.hydrateQueue(row));
  }

  saveQueue(queue: Queue): void {
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO queues (repository, status, parallel, runs_json, acknowledged_json, stop_json, updated_at, autopilot, skip_failed, skipped_json, autopilot_answer, on_limit, next_number, priority_json, auto_answer)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (repository) DO UPDATE SET status = excluded.status, parallel = excluded.parallel, runs_json = excluded.runs_json, acknowledged_json = excluded.acknowledged_json, stop_json = excluded.stop_json, updated_at = excluded.updated_at, autopilot = excluded.autopilot, skip_failed = excluded.skip_failed, skipped_json = excluded.skipped_json, autopilot_answer = excluded.autopilot_answer, on_limit = excluded.on_limit, next_number = excluded.next_number, priority_json = excluded.priority_json, auto_answer = excluded.auto_answer`,
        )
        .run(
          queue.repository,
          queue.status,
          queue.parallel,
          JSON.stringify(queue.runs),
          JSON.stringify(queue.acknowledged),
          json(queue.stop),
          queue.updatedAt,
          queue.autopilot ? 1 : 0,
          queue.skipFailed ? 1 : 0,
          JSON.stringify(queue.skipped),
          queue.autopilotAnswer,
          queue.onLimit,
          queue.nextNumber,
          JSON.stringify(queue.priority),
          queue.autoAnswer ? 1 : 0,
        );
      this.database.prepare('DELETE FROM queue_items WHERE repository = ?').run(queue.repository);
      const insert = this.database.prepare(
        `INSERT INTO queue_items (id, repository, position, workflow, task, groups_json, title, error, created_at, auto_deliver, tags_json, skip_json, after_json, delivery_mode, run_id, postponed, number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      queue.items.forEach((item, position) =>
        insert.run(
          item.id,
          queue.repository,
          position,
          item.workflow,
          item.task,
          json(item.groups),
          item.title,
          item.error,
          item.createdAt,
          item.autoDeliver === null ? null : item.autoDeliver ? 1 : 0,
          JSON.stringify(item.tags),
          JSON.stringify(item.skip),
          JSON.stringify(item.after),
          item.deliveryMode,
          item.run,
          item.postponed ? 1 : 0,
          item.number,
        ),
      );
    });
  }

  private hydrateQueue(row: Row): Queue {
    const repository = String(row.repository);
    const items = this.database
      .prepare('SELECT * FROM queue_items WHERE repository = ? ORDER BY position')
      .all(repository) as Row[];
    return {
      repository,
      status: String(row.status) as Queue['status'],
      parallel: Number(row.parallel),
      autopilot: Number(row.autopilot ?? 0) === 1,
      autoAnswer: Number(row.auto_answer ?? 0) === 1,
      skipFailed: Number(row.skip_failed ?? 0) === 1,
      skipped: row.skipped_json ? parse(row.skipped_json) : [],
      autopilotAnswer: text(row.autopilot_answer ?? null),
      onLimit: ON_LIMIT_MODES.find((mode) => mode === row.on_limit) ?? 'wait',
      nextNumber: Number(row.next_number ?? 1),
      priority: row.priority_json ? parse(row.priority_json) : [],
      items: items.map((item): QueueItem => ({
        id: String(item.id),
        number: Number(item.number),
        workflow: String(item.workflow),
        task: text(item.task ?? null),
        groups: nullable(item.groups_json ?? null),
        title: text(item.title ?? null),
        autoDeliver:
          item.auto_deliver === null || item.auto_deliver === undefined
            ? null
            : Number(item.auto_deliver) === 1,
        deliveryMode: DELIVERY_MODES.find((mode) => mode === item.delivery_mode) ?? null,
        tags: item.tags_json ? parse(item.tags_json) : [],
        skip: item.skip_json ? parse(item.skip_json) : [],
        after: item.after_json ? parse(item.after_json) : [],
        postponed: Number(item.postponed ?? 0) === 1,
        createdAt: Number(item.created_at),
        error: text(item.error ?? null),
        run: text(item.run_id ?? null),
      })),
      runs: parse(row.runs_json ?? null),
      acknowledged: parse(row.acknowledged_json ?? null),
      stop: nullable(row.stop_json ?? null),
      updatedAt: Number(row.updated_at),
    };
  }

  private hydrate(row: Row): RunState {
    const runId = String(row.id);
    const attemptRows = this.database
      .prepare('SELECT * FROM attempts WHERE run_id = ? ORDER BY group_slug, seq')
      .all(runId) as Row[];
    const groupRows = this.database
      .prepare('SELECT * FROM groups WHERE run_id = ? ORDER BY position')
      .all(runId) as Row[];
    const groups = groupRows.map((group) => hydrateGroup(group, attemptRows));
    return {
      run: {
        id: runId,
        repository: String(row.repository),
        workflow: String(row.workflow),
        baseCommit: String(row.base_commit),
        branch: String(row.branch),
        refStyle: String(row.ref_style) as RefStyle,
        createdAt: Number(row.created_at),
        finishedAt: row.finished_at === null ? null : Number(row.finished_at),
        config: withConfigDefaults(parse<ResolvedConfig>(row.config_json ?? null)),
        dirtyWarning: Number(row.dirty_warning) === 1,
        nextMergeSeq: Number(row.next_merge_seq),
        pendingDelivery: nullable(row.pending_delivery_json ?? null),
        title: row.title === null || row.title === undefined ? null : String(row.title),
        name: row.name === null || row.name === undefined ? null : String(row.name),
        namingUsage: nullable(row.naming_usage_json ?? null),
        fromQueue: Number(row.from_queue ?? 0) === 1,
        queueItem: text(row.queue_item ?? null),
        number: Number(row.number ?? 0),
        hold: RUN_HOLDS.find((hold) => hold === row.hold) ?? null,
        tags: row.tags_json ? parse(row.tags_json) : [],
        skippedSteps: row.skipped_steps_json ? parse(row.skipped_steps_json) : [],
      },
      split: groups.find((group) => group.slug === SPLIT_GROUP) ?? null,
      groups: groups.filter(
        (group) => ![SPLIT_GROUP, MESSAGE_GROUP, RESOLVE_GROUP].includes(group.slug),
      ),
      message: groups.find((group) => group.slug === MESSAGE_GROUP) ?? null,
      resolve: groups.find((group) => group.slug === RESOLVE_GROUP) ?? null,
    };
  }
}

function hydrateGroup(group: Row, attemptRows: Row[]): Group {
  return {
    slug: String(group.slug),
    title: String(group.title),
    task: String(group.task),
    position: Number(group.position),
    status: String(group.status) as GroupStatus,
    pending: nullable(group.pending_json ?? null),
    rejections: parse(group.rejections_json ?? null),
    attempts: attemptRows
      .filter((attempt) => attempt.group_slug === group.slug)
      .map((attempt) => hydrateAttempt(attempt)),
    question: text(group.question ?? null),
    questions: nullable(group.questions_json ?? null),
    humanOnly:
      group.human_only === 'review' || group.human_only === 'request' ? group.human_only : null,
    reason: text(group.reason ?? null),
    warnings: parse(group.warnings_json ?? null),
    decisions: parse<(Omit<HumanDecision, 'by'> & { by?: unknown })[]>(
      group.decisions_json ?? null,
    ).map(({ attemptSeq, ...decision }) => ({
      ...decision,
      ...(Number.isInteger(attemptSeq) ? { attemptSeq } : {}),
      by: decision.by === 'autopilot' ? ('autopilot' as const) : ('human' as const),
    })),
    conflictFiles: parse(group.conflict_files_json ?? null),
    mergeSeq: group.merge_seq === null ? null : Number(group.merge_seq),
    mergeInFlight: Number(group.merge_in_flight) === 1,
    updateOnConflict: Number(group.update_on_conflict) === 1,
    mergeCommit: text(group.merge_commit ?? null),
    delivery: { ...pendingDelivery(), ...(group.delivery_json ? parse(group.delivery_json) : {}) },
  };
}

function hydrateAttempt(row: Row): Attempt {
  return {
    seq: Number(row.seq),
    stepId: String(row.step_id),
    stepIndex: Number(row.step_index),
    round: Number(row.round),
    specialist: String(row.specialist),
    runtime: String(row.runtime) as Runtime,
    model: text(row.model ?? null),
    status: String(row.status) as AttemptStatus,
    input: parse(row.input_json ?? null),
    resumeSession: text(row.resume_session ?? null),
    sessionId: text(row.session_id ?? null),
    report: nullable(row.report_json ?? null),
    reason: nullable(row.reason_json ?? null),
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    usage: nullable(row.usage_json ?? null),
    proposal: nullable(row.proposal_json ?? null),
    denials: row.denials_json ? parse(row.denials_json) : [],
    outsideChanges: row.outside_changes_json ? parse(row.outside_changes_json) : [],
  };
}
