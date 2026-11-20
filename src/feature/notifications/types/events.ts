import {
  type HumanOnly,
  type RunState,
  describeFailReason,
  findGroup,
  isRunFinished,
  runPhase,
  runProblems,
} from '../../runs/types/index.ts';

import { withoutPaths } from './limits.ts';

export const EVENT_KINDS = ['question', 'failed', 'conflict', 'delivery', 'finished'] as const;
export type NotificationEventKind = (typeof EVENT_KINDS)[number];

/** What a subscription gets when it names no kinds. */
export const DEFAULT_EVENTS: readonly NotificationEventKind[] = ['question'];

export function isEventKind(value: string): value is NotificationEventKind {
  return (EVENT_KINDS as readonly string[]).includes(value);
}

export interface QuestionData {
  text: string;
  options: string[];
  recommendation: string | null;
}

/** Everything a message about the event says, copied from the run when the event is born. */
export interface EventData {
  number: number;
  title: string;
  project: string;
  pipeline: string;
  group: string | null;
  groupTitle: string | null;
  step: string | null;
  /** The question as one text, for a question without structure and for a review. */
  question: string | null;
  questions: QuestionData[] | null;
  humanOnly: HumanOnly | null;
  summary: string | null;
  reason: string | null;
  outcome: 'finished' | 'failed' | 'cancelled' | null;
  merged: number;
  groups: number;
  /** How many decisions the group had when the event was born; one more means the question was answered. */
  asked: number;
}

export interface NotificationEvent {
  /** Unique per event; changes with a new attempt of the group. */
  key: string;
  kind: NotificationEventKind;
  run: string;
  /** Root of the project of the run. */
  repository: string;
  group: string | null;
  data: EventData;
}

const CONFLICT_FILES = 5;

function projectName(repository: string): string {
  return (
    repository
      .split('/')
      .filter((part) => part !== '')
      .at(-1) ?? repository
  );
}

function baseData(state: RunState): EventData {
  const { run } = state;
  return {
    number: run.number,
    title: withoutPaths(run.title ?? run.name ?? '', run.repository),
    project: projectName(run.repository),
    pipeline: run.pipeline,
    group: null,
    groupTitle: null,
    step: null,
    question: null,
    questions: null,
    humanOnly: null,
    summary: null,
    reason: null,
    outcome: null,
    merged: state.groups.filter((group) => group.status === 'merged').length,
    groups: state.groups.length,
    asked: 0,
  };
}

function groupData(state: RunState, slug: string): EventData {
  const data = baseData(state);
  const group = findGroup(state, slug);
  if (group === undefined) return { ...data, group: slug };
  const last = group.attempts.at(-1);
  const clean = (text: string): string => withoutPaths(text, state.run.repository);
  return {
    ...data,
    group: group.slug,
    groupTitle: clean(group.title),
    step: last?.stepId ?? null,
    summary: last?.report?.summary ? clean(last.report.summary) : null,
    question: group.question === null ? null : clean(group.question),
    humanOnly: group.humanOnly,
    questions:
      group.questions === null
        ? null
        : group.questions.map((question) => ({
            text: question.text,
            options: question.options ?? [],
            recommendation: question.recommendation ?? null,
          })),
    reason: failureReason(state, slug),
    asked: group.decisions.length,
  };
}

function failureReason(state: RunState, slug: string): string | null {
  const group = findGroup(state, slug);
  if (group === undefined) return null;
  const root = state.run.repository;
  if (group.status === 'conflict') {
    const files = group.conflictFiles.slice(0, CONFLICT_FILES).join(', ');
    return withoutPaths(files === '' ? 'merge conflict' : `merge conflict: ${files}`, root);
  }
  const text =
    group.status === 'merged'
      ? group.delivery.reason
      : (group.reason ?? describeLast(group.attempts.at(-1)?.reason ?? null));
  return text === null || text === '' ? null : withoutPaths(text, root);
}

function describeLast(reason: Parameters<typeof describeFailReason>[0] | null): string | null {
  return reason === null ? null : describeFailReason(reason);
}

/** The events the state of a run holds now: open questions, problems, the end of the task. */
export function notificationEvents(state: RunState): NotificationEvent[] {
  const events: NotificationEvent[] = [];
  const kinds = {
    needs_human: 'question',
    failed: 'failed',
    conflict: 'conflict',
    apply_failed: 'delivery',
  } as const;
  for (const problem of runProblems(state)) {
    if (problem.group === null || !(problem.reason in kinds)) continue;
    events.push({
      key: problem.key,
      kind: kinds[problem.reason as keyof typeof kinds],
      run: problem.run,
      repository: state.run.repository,
      group: problem.group,
      data: groupData(state, problem.group),
    });
  }
  if (isRunFinished(state)) {
    const outcome = runPhase(state);
    if (outcome === 'finished' || outcome === 'failed' || outcome === 'cancelled') {
      events.push({
        key: `${state.run.id}/run/${outcome}/${state.run.finishedAt ?? 0}`,
        kind: 'finished',
        run: state.run.id,
        repository: state.run.repository,
        group: null,
        data: { ...baseData(state), outcome },
      });
    }
  }
  return events;
}

/** The data of a message that belongs to no run: the test message of a subscription. */
export function emptyEventData(): EventData {
  return {
    number: 0,
    title: '',
    project: '',
    pipeline: '',
    group: null,
    groupTitle: null,
    step: null,
    question: null,
    questions: null,
    humanOnly: null,
    summary: null,
    reason: null,
    outcome: null,
    merged: 0,
    groups: 0,
    asked: 0,
  };
}
