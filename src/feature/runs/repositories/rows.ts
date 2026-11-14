import type { SQLInputValue } from 'node:sqlite';

import {
  withConfigDefaults,
  type ResolvedConfig,
  type Runtime,
} from '../../swarm-config/types/index.ts';
import type { HumanDecision } from '../../agents/types/index.ts';
import type { Database, Row } from '../../../platform/sqlite/index.ts';
import { nullable, parse, text } from '../../../platform/sqlite/index.ts';
import {
  type Attempt,
  type AttemptStatus,
  type Group,
  type GroupStatus,
  type RefStyle,
  type RunState,
  MESSAGE_GROUP,
  RUN_HOLDS,
  REPAIR_GROUP,
  RESOLVE_GROUP,
  emptyRepair,
  SPLIT_GROUP,
  isActionGroup,
  pendingDelivery,
} from '../types/index.ts';

export function hydrateRun(database: Database, row: Row): RunState {
  const runId = String(row.id);
  const attemptRows = database
    .prepare('SELECT * FROM attempts WHERE run_id = ? ORDER BY group_slug, seq')
    .all(runId) as Row[];
  const groupRows = database
    .prepare('SELECT * FROM groups WHERE run_id = ? ORDER BY position')
    .all(runId) as Row[];
  const groups = groupRows.map((group) => hydrateGroup(group, attemptRows));
  return {
    run: {
      id: runId,
      repository: String(row.repository),
      pipeline: String(row.pipeline),
      variant: row.variant === null || row.variant === undefined ? 'default' : String(row.variant),
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
      repair: hydrateRepair(row.repair_json ?? null),
    },
    split: groups.find((group) => group.slug === SPLIT_GROUP) ?? null,
    groups: groups.filter(
      (group) =>
        ![SPLIT_GROUP, MESSAGE_GROUP, RESOLVE_GROUP, REPAIR_GROUP].includes(group.slug) &&
        !isActionGroup(group),
    ),
    message: groups.find((group) => group.slug === MESSAGE_GROUP) ?? null,
    resolve: groups.find((group) => group.slug === RESOLVE_GROUP) ?? null,
    repair: groups.find((group) => group.slug === REPAIR_GROUP) ?? null,
    actions: groups.filter(isActionGroup),
  };
}

function hydrateRepair(value: SQLInputValue): RunState['run']['repair'] {
  if (typeof value !== 'string') return emptyRepair();
  try {
    return { ...emptyRepair(), ...(JSON.parse(value) as object) };
  } catch {
    return emptyRepair();
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
