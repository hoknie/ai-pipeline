import { groupWorkflow } from '../config/index.ts';

import {
  cancelDelivery,
  finishDelivery,
  finishMessage,
  requestDelivery,
  resolvePrepared,
  resolverDone,
  type DeliveryEffect,
  type DeliveryResult,
} from './delivery.ts';
import { Rejection } from './errors.ts';
import { checkSkip, lastUnskipped, nextUnskipped, stepStates } from './skip.ts';
import {
  refreshPermissions,
  refreshSpecialists,
  type Denial,
  type PermissionsRefresh,
  type SpecialistsRefresh,
} from './permissions.ts';
import { groupSlugs } from './ids.ts';
import { questionsText } from './questions.ts';
import {
  addUsage,
  allGroups,
  attemptVerdict,
  describeFailReason,
  findGroup,
  isMessageGroup,
  isResolveGroup,
  isServiceGroup,
  isSplitGroup,
  newGroup,
  stepsOf,
  freshPending,
  isRunFinished,
  isTerminal,
  runWorkflow,
  validateReport,
  type Attempt,
  type FailReason,
  type Group,
  type HumanQuestion,
  type OnLimit,
  type ProposedGroup,
  type Report,
  type RunState,
  type Usage,
} from './model.ts';

export type Effect =
  | { kind: 'start_attempt'; run: string; group: string; seq: number }
  | { kind: 'stop_attempt'; run: string; group: string; seq: number }
  | { kind: 'commit'; run: string; group: string; stepId: string; summary: string }
  | { kind: 'merge'; run: string; group: string; updateOnConflict: boolean }
  | DeliveryEffect;

export type MergeOutcome =
  | { kind: 'merged'; commit: string | null }
  | { kind: 'conflict'; files: string[] }
  | { kind: 'conflict_updated'; files: string[] }
  | { kind: 'failed'; message: string };

export interface AttemptExit {
  sessionId: string | null;
  usage: Usage | null;
  failure: FailReason | null;
  outsideChanges: string[];
  /** Tool calls the agent CLI refused; absent when the runtime does not report them. */
  denials?: Denial[];
  /** What a usage limit does to the group: `wait` (default) keeps it queued, `stop` fails it. */
  onLimit?: OnLimit;
}

export type Event =
  | { kind: 'report'; group: string; seq: number; report: Report }
  | { kind: 'split_proposed'; seq: number; groups: ProposedGroup[] }
  | { kind: 'attempt_exited'; group: string; seq: number; exit: AttemptExit }
  | { kind: 'attempt_usage'; updates: { group: string; seq: number; usage: Usage }[] }
  | { kind: 'timed_out'; group: string; seq: number }
  | { kind: 'cancel'; group: string | null }
  | {
      kind: 'retry';
      group: string;
      permissions?: PermissionsRefresh;
      /** The whole specialists of the current configuration; replaces `permissions` when set. */
      specialists?: SpecialistsRefresh;
    }
  | {
      kind: 'answer';
      group: string;
      answer: string;
      by?: 'human' | 'autopilot';
      permissions?: PermissionsRefresh;
    }
  | { kind: 'merge_finished'; group: string; outcome: MergeOutcome }
  | { kind: 'commit_failed'; group: string; message: string }
  | { kind: 'deliver_requested'; groups: string[] | null; force: boolean; files: string[] }
  | { kind: 'delivery_finished'; result: DeliveryResult }
  | { kind: 'resolve_prepared'; conflicts: string[] }
  | { kind: 'run_named'; title: string | null; name: string | null; usage: Usage | null }
  | { kind: 'tags_set'; tags: string[] }
  | { kind: 'step_skip'; step: string; skip: boolean }
  | { kind: 'interrupted' };

export { Rejection };

function wrongStatus(group: Group, action: string, expected: string): Rejection {
  return new Rejection(`group \`${group.slug}\` is ${group.status}; ${action} needs ${expected}`);
}

function updateFinished(state: RunState, now: number): void {
  if (!isRunFinished(state)) state.run.finishedAt = null;
  else if (state.run.finishedAt === null) state.run.finishedAt = now;
}

export function transition(state: RunState, event: Event, now: number): Effect[] {
  const machine = new Machine(state, now);
  const wasFinished = state.run.finishedAt !== null;
  machine.apply(event);
  machine.skipAhead();
  machine.startNextMerge();
  updateFinished(state, now);
  if (!wasFinished && state.run.finishedAt !== null && state.run.config.delivery.auto) {
    machine.autoDeliver();
    updateFinished(state, now);
  }
  return machine.effects;
}

class Machine {
  readonly effects: Effect[] = [];
  private readonly state: RunState;
  private readonly now: number;

  constructor(state: RunState, now: number) {
    this.state = state;
    this.now = now;
  }

  private group(slug: string): Group {
    const group = findGroup(this.state, slug);
    if (!group) throw new Rejection(`unknown group \`${slug}\``);
    return group;
  }

  private running(group: Group, seq: number): Attempt | undefined {
    return group.attempts.find((attempt) => attempt.seq === seq && attempt.status === 'running');
  }

  apply(event: Event): void {
    switch (event.kind) {
      case 'report':
        return this.report(event.group, event.seq, event.report);
      case 'split_proposed':
        return this.proposeSplit(event.seq, event.groups);
      case 'attempt_exited':
        return this.exited(event.group, event.seq, event.exit);
      case 'attempt_usage':
        for (const update of event.updates) {
          const group = findGroup(this.state, update.group);
          const attempt = group ? this.running(group, update.seq) : undefined;
          if (attempt) attempt.usage = update.usage;
        }
        return;
      case 'timed_out':
        return this.timedOut(event.group, event.seq);
      case 'cancel':
        return this.cancel(event.group);
      case 'retry':
        return this.retry(event.group, event.permissions, event.specialists);
      case 'answer':
        return this.answer(event.group, event.answer, event.by ?? 'human', event.permissions);
      case 'merge_finished':
        return this.mergeFinished(event.group, event.outcome);
      case 'deliver_requested':
        this.effects.push(
          ...requestDelivery(this.state, {
            groups: event.groups,
            force: event.force,
            files: event.files,
            auto: false,
          }),
        );
        return;
      case 'delivery_finished':
        this.effects.push(...finishDelivery(this.state, event.result));
        return;
      case 'run_named':
        if (this.state.run.title === null && event.title !== null) {
          this.state.run.title = event.title;
          this.state.run.name = event.name;
        }
        this.state.run.namingUsage = addUsage(this.state.run.namingUsage, event.usage);
        return;
      case 'tags_set':
        this.state.run.tags = [...event.tags];
        return;
      case 'step_skip':
        return this.stepSkip(event.step, event.skip);
      case 'resolve_prepared':
        this.effects.push(...resolvePrepared(this.state, event.conflicts));
        return;
      case 'commit_failed':
        return this.failGroup(this.group(event.group), { kind: 'git', message: event.message });
      case 'interrupted':
        return this.interrupted();
    }
  }

  private report(slug: string, seq: number, report: Report): void {
    const attempt = this.running(this.group(slug), seq);
    if (!attempt) throw new Rejection(`attempt ${seq} is not running`);
    const problem = validateReport(report);
    if (problem !== null) throw new Rejection(`invalid report: ${problem}`);
    attempt.report = {
      verdict: report.verdict,
      summary: report.summary,
      feedback: report.feedback?.trim()
        ? report.feedback
        : report.questions
          ? questionsText(report.questions)
          : null,
      ...(report.questions ? { questions: report.questions } : {}),
    };
  }

  private proposeSplit(seq: number, groups: ProposedGroup[]): void {
    const split = this.state.split;
    const attempt = split ? this.running(split, seq) : undefined;
    if (!split || !attempt) throw new Rejection(`attempt ${seq} is not a running split step`);
    const maxGroups = runWorkflow(this.state.run).split?.maxGroups ?? 1;
    if (groups.length < 1 || groups.length > maxGroups) {
      throw new Rejection(`propose from 1 to ${maxGroups} groups, got ${groups.length}`);
    }
    const empty = groups.findIndex(
      (group) => group.title.trim() === '' || group.task.trim() === '',
    );
    if (empty !== -1) throw new Rejection(`group ${empty + 1} needs a non-empty title and task`);
    attempt.proposal = groups.map((group) => ({ title: group.title.trim(), task: group.task }));
  }

  private exited(slug: string, seq: number, exit: AttemptExit): void {
    const group = this.group(slug);
    const attempt = this.running(group, seq);
    if (!attempt) {
      // Cancelled or timed out before the process ended: only the usage is still unknown.
      const stopped = group.attempts.find((item) => item.seq === seq);
      if (stopped && exit.usage !== null && stopped.finishedAt !== null) stopped.usage = exit.usage;
      return;
    }
    attempt.finishedAt = this.now;
    if (exit.sessionId !== null) attempt.sessionId = exit.sessionId;
    attempt.usage = exit.usage ?? attempt.usage;
    attempt.denials = exit.denials ?? [];
    attempt.outsideChanges = [...exit.outsideChanges];
    // A report sent before the limit ran out counts as usual.
    const limited = exit.failure?.kind === 'usage_limit' && attempt.report !== null;
    const failure = limited
      ? null
      : (exit.failure ?? (attempt.report === null ? { kind: 'no_report' } : null));
    if (failure !== null) {
      attempt.status = 'failed';
      attempt.reason = failure;
      if (failure.kind === 'usage_limit' && (exit.onLimit ?? 'wait') === 'wait') {
        this.waitForLimit(group, attempt);
        return;
      }
      this.failGroup(group, failure);
      return;
    }
    attempt.status = 'finished';
    const report = attempt.report as Report;
    if (report.verdict !== 'needs_human' && !isServiceGroup(group)) {
      this.effects.push({
        kind: 'commit',
        run: this.state.run.id,
        group: slug,
        stepId: attempt.stepId,
        summary: report.summary,
      });
    }
    if (exit.outsideChanges.length > 0 && this.state.run.config.outsideChanges === 'stop') {
      const files = exit.outsideChanges.join(', ');
      this.askHuman(
        group,
        attempt.stepIndex,
        `Files in your working copy changed while step ${attempt.stepId} ran: ${files}. The specialist, you or another program may have changed them; aip deliveries are not counted. Check your working copy and answer to continue.`,
        null,
      );
      return;
    }
    if (isResolveGroup(group)) this.finishResolve(group, report);
    else if (report.verdict === 'done' && isMessageGroup(group))
      this.finishMessage(group, report.summary);
    else if (report.verdict === 'done' && isSplitGroup(group)) this.finishSplit(group, attempt);
    else if (report.verdict === 'done') this.advance(group, attempt.stepIndex);
    else if (report.verdict === 'rejected') this.rejected(group, attempt, report.feedback ?? '');
    else this.askHuman(group, attempt.stepIndex, report.feedback ?? '', report.questions ?? null);
  }

  private finishSplit(split: Group, attempt: Attempt): void {
    const proposal = attempt.proposal;
    if (!proposal || proposal.length === 0) {
      attempt.status = 'failed';
      attempt.reason = { kind: 'no_groups' };
      this.failGroup(split, { kind: 'no_groups' });
      return;
    }
    const slugs = groupSlugs(proposal.map((group) => group.title));
    this.state.groups = proposal.map((group, index) =>
      newGroup(slugs[index] ?? `group-${index + 1}`, group.title, group.task, index),
    );
    split.status = 'merged';
    split.pending = null;
  }

  private finishResolve(group: Group, report: Report): void {
    group.pending = null;
    if (report.verdict === 'done') {
      group.status = 'merged';
      this.effects.push(...resolverDone(this.state));
      return;
    }
    const detail = (report.feedback ?? report.summary).trim();
    group.status = 'failed';
    group.reason = `resolver reported ${report.verdict}`;
    this.effects.push(
      ...finishDelivery(this.state, {
        kind: 'failed',
        message: `the resolver reported ${report.verdict}${detail ? `: ${detail}` : ''}`,
      }),
    );
  }

  private finishMessage(group: Group, summary: string | null): void {
    if (summary !== null) {
      group.status = 'merged';
      group.pending = null;
    }
    this.effects.push(...finishMessage(this.state, summary));
  }

  autoDeliver(): void {
    if (
      !this.state.groups.some(
        (group) => group.status === 'merged' && group.delivery.state === 'pending',
      )
    ) {
      return;
    }
    try {
      this.effects.push(
        ...requestDelivery(this.state, { groups: null, force: false, files: [], auto: true }),
      );
    } catch (error) {
      if (!(error instanceof Rejection)) throw error;
    }
  }

  private advance(group: Group, current: number): void {
    const next = current + 1;
    if (next < stepsOf(this.state.run, group).length) {
      group.status = 'queued';
      group.pending = freshPending(next);
    } else {
      this.enqueueMerge(group, false);
    }
  }

  private rejected(group: Group, attempt: Attempt, feedback: string): void {
    const steps = stepsOf(this.state.run, group);
    const onReject = steps[attempt.stepIndex]?.onReject ?? null;
    if (onReject === null) {
      this.askHuman(group, attempt.stepIndex, feedback, null);
      return;
    }
    const rounds = (group.rejections[attempt.stepId] ?? 0) + 1;
    if (rounds > onReject.maxRounds) {
      this.askHuman(
        group,
        attempt.stepIndex,
        `Step \`${attempt.stepId}\` rejected the work ${rounds} times (limit ${onReject.maxRounds}). Last feedback:\n${feedback}`,
        null,
      );
      return;
    }
    group.rejections[attempt.stepId] = rounds;
    group.status = 'queued';
    group.pending = {
      stepIndex: steps.findIndex((step) => step.id === onReject.goto),
      feedback,
      humanAnswer: null,
      resume: false,
    };
  }

  private askHuman(
    group: Group,
    step: number,
    question: string,
    questions: HumanQuestion[] | null,
  ): void {
    group.status = 'needs_human';
    group.question = question;
    group.questions = questions;
    group.pending = { stepIndex: step, feedback: null, humanAnswer: null, resume: true };
  }

  private restorePending(group: Group): void {
    const last = group.attempts.at(-1);
    if (group.pending === null && last) {
      group.pending = {
        stepIndex: last.stepIndex,
        feedback: last.input.feedback,
        humanAnswer: last.input.humanAnswer,
        resume: false,
      };
    }
  }

  /** The group waits in `queued` for the same step; the scheduler holds it until the limit resets. */
  private waitForLimit(group: Group, attempt: Attempt): void {
    if (isTerminal(group.status)) return;
    group.pending = {
      stepIndex: attempt.stepIndex,
      feedback: attempt.input.feedback,
      humanAnswer: attempt.input.humanAnswer,
      resume: attempt.sessionId !== null,
    };
    group.status = 'queued';
    group.reason = null;
  }

  private failGroup(group: Group, reason: FailReason): void {
    if (isTerminal(group.status)) return;
    this.restorePending(group);
    group.status = 'failed';
    group.reason = describeFailReason(reason);
    if (isMessageGroup(group)) this.finishMessage(group, null);
    if (isResolveGroup(group)) {
      group.pending = null;
      this.effects.push(
        ...finishDelivery(this.state, {
          kind: 'failed',
          message: `the resolver failed: ${describeFailReason(reason)}`,
        }),
      );
    }
  }

  private timedOut(slug: string, seq: number): void {
    const group = this.group(slug);
    const attempt = this.running(group, seq);
    if (!attempt) return;
    attempt.status = 'failed';
    attempt.reason = { kind: 'timeout' };
    attempt.finishedAt = this.now;
    this.effects.push({ kind: 'stop_attempt', run: this.state.run.id, group: slug, seq });
    this.failGroup(group, { kind: 'timeout' });
  }

  private cancel(only: string | null): void {
    const groups = only === null ? allGroups(this.state) : [this.group(only)];
    for (const group of groups) {
      if (isTerminal(group.status)) continue;
      group.status = 'cancelled';
      group.mergeInFlight = false;
      if (isMessageGroup(group) || isResolveGroup(group)) cancelDelivery(this.state);
      for (const attempt of group.attempts) {
        if (attempt.status !== 'running') continue;
        attempt.status = 'cancelled';
        attempt.finishedAt = this.now;
        this.effects.push({
          kind: 'stop_attempt',
          run: this.state.run.id,
          group: group.slug,
          seq: attempt.seq,
        });
      }
    }
  }

  private stepSkip(step: string, skip: boolean): void {
    const { run } = this.state;
    const steps = groupWorkflow(run.config, runWorkflow(run)).steps;
    const index = steps.findIndex((candidate) => candidate.id === step);
    if (index === -1) {
      throw new Rejection(
        `unknown step \`${step}\`; steps: ${steps.map((candidate) => candidate.id).join(', ')}`,
      );
    }
    if (stepStates(this.state)[index]?.state === 'done') {
      throw new Rejection(`step \`${step}\` is already passed by every group`);
    }
    const current = run.skippedSteps.includes(step);
    if (skip === current) return;
    const wanted = skip
      ? [...run.skippedSteps, step]
      : run.skippedSteps.filter((item) => item !== step);
    if (skip) {
      const error = checkSkip(run.config, run.workflow, wanted);
      if (error !== null) throw new Rejection(error);
    }
    run.skippedSteps = steps.map((item) => item.id).filter((id) => wanted.includes(id));
    if (!skip) return;
    for (const group of this.state.groups) {
      const running = group.attempts.find(
        (attempt) => attempt.status === 'running' && attempt.stepIndex === index,
      );
      if (running) {
        running.status = 'cancelled';
        running.reason = { kind: 'skipped' };
        running.finishedAt = this.now;
        this.effects.push({
          kind: 'stop_attempt',
          run: run.id,
          group: group.slug,
          seq: running.seq,
        });
        group.status = 'queued';
        group.pending = {
          stepIndex: index,
          feedback: running.input.feedback,
          humanAnswer: null,
          resume: false,
        };
      } else if (group.status === 'needs_human' && group.pending?.stepIndex === index) {
        group.status = 'queued';
        group.question = null;
        group.questions = null;
        group.pending = { ...group.pending, humanAnswer: null, resume: false };
      }
    }
  }

  /** A queued group never waits on a skipped step: it moves on, or goes to the merge. */
  skipAhead(): void {
    const { run } = this.state;
    if (run.skippedSteps.length === 0) return;
    for (const group of this.state.groups) {
      if (group.status !== 'queued' || group.pending === null) continue;
      const step = stepsOf(run, group)[group.pending.stepIndex];
      if (!step || !run.skippedSteps.includes(step.id)) continue;
      const next = nextUnskipped(run, group, group.pending.stepIndex + 1);
      if (next === null) {
        this.enqueueMerge(group, false);
      } else {
        group.pending = {
          stepIndex: next,
          feedback: group.pending.feedback,
          humanAnswer: null,
          resume: false,
        };
      }
    }
  }

  private retry(
    slug: string,
    permissions?: PermissionsRefresh,
    specialists?: SpecialistsRefresh,
  ): void {
    const group = this.group(slug);
    if (group.status === 'failed' || group.status === 'cancelled') this.rejectDeliveryRetry(group);
    if (group.status === 'failed') {
      group.status = 'queued';
      group.reason = null;
    } else if (group.status === 'conflict') {
      this.enqueueMerge(group, true);
    } else if (group.status === 'cancelled') {
      this.retryCancelled(group);
    } else {
      throw wrongStatus(group, 'retry', 'failed, cancelled or conflict');
    }
    // After every check: a refused retry leaves the snapshot as it was.
    if (specialists) {
      const changes = refreshSpecialists(this.state.run.config, specialists);
      group.warnings.push(
        `config refreshed: ${changes.length > 0 ? changes.join('; ') : 'no changes'}`,
      );
    } else {
      this.refresh(group, permissions);
    }
  }

  private rejectDeliveryRetry(group: Group): void {
    if (isMessageGroup(group) || isResolveGroup(group)) {
      throw new Rejection(
        `group ${group.slug} is ${group.status}; delivery is retried with \`aip run apply\``,
      );
    }
  }

  private retryCancelled(group: Group): void {
    group.reason = null;
    if (group.question !== null) {
      group.status = 'needs_human';
      return;
    }
    const last = group.attempts.at(-1);
    if (
      group.pending === null &&
      last &&
      !isSplitGroup(group) &&
      attemptVerdict(last) === 'done' &&
      last.stepIndex + 1 >= stepsOf(this.state.run, group).length
    ) {
      this.enqueueMerge(group, false);
      return;
    }
    this.restorePending(group);
    group.status = 'queued';
  }

  /** Takes the permissions of the current configuration into the snapshot of the run. */
  private refresh(group: Group, permissions: PermissionsRefresh | undefined): void {
    if (!permissions) return;
    const error = refreshPermissions(this.state.run.config, permissions);
    if (error !== null) group.warnings.push(`permissions not refreshed: ${error}`);
  }

  private answer(
    slug: string,
    answer: string,
    by: 'human' | 'autopilot',
    permissions?: PermissionsRefresh,
  ): void {
    if (answer.trim() === '') throw new Rejection('answer must not be empty');
    const group = this.group(slug);
    if (group.status !== 'needs_human') throw wrongStatus(group, 'answer', 'needs_human');
    this.refresh(group, permissions);
    const stepId =
      group.attempts.find((candidate) => candidate.stepIndex === group.pending?.stepIndex)
        ?.stepId ??
      group.attempts.at(-1)?.stepId ??
      '';
    group.decisions.push({ stepId, question: group.question ?? '', answer, by });
    group.status = 'queued';
    group.question = null;
    group.questions = null;
    if (group.pending) group.pending.humanAnswer = answer;
  }

  private enqueueMerge(group: Group, updateOnConflict: boolean): void {
    group.status = 'merging';
    group.pending = null;
    group.mergeSeq = this.state.run.nextMergeSeq;
    this.state.run.nextMergeSeq += 1;
    group.mergeInFlight = false;
    group.updateOnConflict = updateOnConflict;
  }

  private mergeFinished(slug: string, outcome: MergeOutcome): void {
    const group = this.group(slug);
    if (group.status !== 'merging' || !group.mergeInFlight) return;
    group.mergeInFlight = false;
    group.updateOnConflict = false;
    switch (outcome.kind) {
      case 'merged':
        group.status = 'merged';
        group.mergeCommit = outcome.commit;
        group.conflictFiles = [];
        group.reason = null;
        break;
      case 'conflict':
        group.status = 'conflict';
        group.conflictFiles = outcome.files;
        group.reason = `merge conflict in ${outcome.files.join(', ')}`;
        break;
      case 'conflict_updated':
        group.status = 'queued';
        group.conflictFiles = outcome.files;
        group.reason = null;
        group.pending = {
          stepIndex: lastUnskipped(this.state.run, group),
          feedback: `The branch of this group was updated from the run branch and has merge conflicts in: ${outcome.files.join(', ')}. Resolve every conflict, keep the intent of both sides, and report done.`,
          humanAnswer: null,
          resume: false,
        };
        break;
      case 'failed':
        this.failGroup(group, { kind: 'git', message: outcome.message });
        break;
    }
  }

  startNextMerge(): void {
    if (this.state.groups.some((group) => group.mergeInFlight)) return;
    const next = this.state.groups
      .filter((group) => group.status === 'merging')
      .sort((left, right) => (left.mergeSeq ?? 0) - (right.mergeSeq ?? 0))[0];
    if (!next) return;
    next.mergeInFlight = true;
    this.effects.push({
      kind: 'merge',
      run: this.state.run.id,
      group: next.slug,
      updateOnConflict: next.updateOnConflict,
    });
  }

  private interrupted(): void {
    // Whatever the delivery was doing (git work, the message writer, the resolver) died with
    // the old daemon; drop it before failing its service groups, then start it again.
    const delivery = this.state.run.pendingDelivery;
    this.state.run.pendingDelivery = null;
    for (const group of allGroups(this.state)) {
      let wasRunning = false;
      for (const attempt of group.attempts) {
        if (attempt.status !== 'running') continue;
        attempt.status = 'failed';
        attempt.reason = { kind: 'interrupted' };
        attempt.finishedAt = this.now;
        wasRunning = true;
      }
      group.mergeInFlight = false;
      if (wasRunning) this.failGroup(group, { kind: 'interrupted' });
    }
    if (delivery) {
      try {
        this.effects.push(
          ...requestDelivery(this.state, {
            groups: delivery.groups,
            force: delivery.force,
            files: [],
            auto: delivery.auto,
          }),
        );
      } catch (error) {
        if (!(error instanceof Rejection)) throw error;
      }
    }
  }
}
