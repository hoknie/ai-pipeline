import { groupPipeline, type Specialist } from '../config/index.ts';

import {
  advanceChecks,
  afterDeliveryDone,
  cancelDelivery,
  finishDelivery,
  finishMessage,
  renderCommitMessage,
  cleanupIfDelivered,
  markDelivered,
  requestDelivery,
  resolvePrepared,
  resolverDone,
  type DeliveryEffect,
  type DeliveryResult,
} from './delivery.ts';
import { Rejection } from './errors.ts';
import { closeRepair, openRepairGroup, repairTask } from './observer.ts';
import { checkSkip, lastUnskipped, nextUnskipped, stepStates } from './skip.ts';
import {
  refreshPermissions,
  refreshSpecialists,
  type Denial,
  type PermissionsRefresh,
  type SpecialistsRefresh,
} from './permissions.ts';
import { groupSlugs } from './ids.ts';
import { retryableGroups } from './retryable.ts';
import { enterPoint } from './stages.ts';
import { attemptStepLabel } from './topology.ts';
import { questionsText, reviewQuestion } from './questions.ts';
import {
  addUsage,
  allGroups,
  attemptVerdict,
  describeFailReason,
  findGroup,
  isMessageGroup,
  isRepairGroup,
  isResolveGroup,
  isServiceGroup,
  isSplitGroup,
  newGroup,
  stepsOf,
  freshPending,
  isActionGroup,
  REPAIR_GROUP,
  actionGroupsOf,
  deliveryCheckActive,
  actionPointOf,
  pointClosed,
  pointStalled,
  isRunFinished,
  isTerminal,
  runPipeline,
  validateReport,
  type Attempt,
  type FailReason,
  type Group,
  type HumanOnly,
  type HumanQuestion,
  type Incident,
  type OnLimit,
  type ProposedGroup,
  type Report,
  type RunHold,
  type RunState,
  type Usage,
} from './model.ts';

export type Effect =
  | { kind: 'start_attempt'; run: string; group: string; seq: number }
  | { kind: 'stop_attempt'; run: string; group: string; seq: number }
  | { kind: 'commit'; run: string; group: string; stepId: string; summary: string }
  | { kind: 'merge'; run: string; group: string; updateOnConflict: boolean }
  /** The daemon runs the shell command of a pipeline action. */
  | { kind: 'run_action'; run: string; group: string; seq: number }
  | DeliveryEffect;

/** How a command action ended. */
export type ActionOutcome =
  { kind: 'exit'; code: number } | { kind: 'timeout' } | { kind: 'spawn'; message: string };

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
  | { kind: 'action_finished'; group: string; seq: number; outcome: ActionOutcome }
  | { kind: 'message'; group: string; seq: number; text: string }
  /** `reason`: why an observer cancels; it is written to the cancelled groups. */
  | { kind: 'cancel'; group: string | null; reason?: string }
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
      by?: 'human' | 'autopilot' | 'observer';
      permissions?: PermissionsRefresh;
    }
  | { kind: 'merge_finished'; group: string; outcome: MergeOutcome }
  | { kind: 'commit_failed'; group: string; message: string }
  | { kind: 'deliver_requested'; groups: string[] | null; force: boolean; files: string[] }
  | { kind: 'delivered_marked'; groups: string[] | null }
  | { kind: 'delivery_finished'; result: DeliveryResult }
  | { kind: 'resolve_prepared'; conflicts: string[] }
  | { kind: 'run_named'; title: string | null; name: string | null; usage: Usage | null }
  | { kind: 'tags_set'; tags: string[] }
  | { kind: 'title_set'; title: string }
  | { kind: 'step_skip'; step: string; skip: boolean }
  | { kind: 'hold'; hold: RunHold | null }
  /** An observer takes the incident; `specialist` is its profile at this moment. */
  | { kind: 'repair_start'; incident: Incident; specialist: Specialist }
  /** The user lets observers take the task (true) or forbids it (false). */
  | { kind: 'repair_allowed'; allowed: boolean }
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
  const wasDone = afterDeliveryDone(state);
  const heldBefore = state.run.hold !== null;
  machine.apply(event);
  machine.pipeline(wasDone);
  machine.skipAhead();
  machine.startNextMerge();
  updateFinished(state, now);
  // A pause cancelled the repair of a task with nothing to retry (a delivery incident): the pause
  // stays, or the incident would be taken again at once. A finished task that was held before the
  // event is such a task.
  const keepHold = machine.pausedRepair || (wasFinished && heldBefore);
  if (state.run.finishedAt !== null && retryableGroups(state).length === 0 && !keepHold) {
    state.run.hold = null;
  }
  if (!wasFinished && state.run.finishedAt !== null && state.run.config.delivery.auto) {
    machine.autoDeliver();
    updateFinished(state, now);
  }
  if (state.run.finishedAt !== null && retryableGroups(state).length === 0 && !keepHold) {
    state.run.hold = null;
  }
  return machine.effects;
}

class Machine {
  readonly effects: Effect[] = [];
  /** The whole run was cancelled while its delivery waited for the checks: no automatic delivery follows. */
  private checksCancelled = false;
  /** A pause ended the repair that went on. */
  pausedRepair = false;
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
      case 'action_finished':
        return this.actionFinished(event.group, event.seq, event.outcome);
      case 'message':
        return this.message(event.group, event.seq, event.text);
      case 'cancel':
        return this.cancel(event.group, event.reason);
      case 'retry':
        return this.retry(event.group, event.permissions, event.specialists);
      case 'answer':
        return this.answer(event.group, event.answer, event.by ?? 'human', event.permissions);
      case 'merge_finished':
        return this.mergeFinished(event.group, event.outcome);
      case 'delivered_marked':
        this.effects.push(...markDelivered(this.state, event.groups, this.now));
        return;
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
        this.effects.push(...finishDelivery(this.state, event.result, this.now));
        return;
      case 'run_named':
        if (this.state.run.title === null && event.title !== null) {
          this.state.run.title = event.title;
          this.state.run.name = event.name;
        }
        this.state.run.namingUsage = addUsage(this.state.run.namingUsage, event.usage);
        return;
      case 'title_set':
        this.state.run.title = event.title;
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
        return this.commitFailed(this.group(event.group), event.message);
      case 'hold':
        return this.hold(event.hold);
      case 'interrupted':
        return this.interrupted();
      case 'repair_start':
        return this.repairStart(event.incident, event.specialist);
      case 'repair_allowed':
        return this.repairAllowed(event.allowed);
    }
  }

  /** The commit of a step failed. The group of an action is merged by then: it fails, and the pipeline waits. */
  private commitFailed(group: Group, message: string): void {
    if (!isActionGroup(group)) {
      this.failGroup(group, { kind: 'git', message });
      return;
    }
    group.status = 'failed';
    group.reason = describeFailReason({ kind: 'git', message });
    group.pending = freshPending(0);
  }

  private hold(hold: RunHold | null): void {
    if (hold !== null && this.state.run.finishedAt !== null && this.state.run.hold === null) {
      throw new Rejection('a finished run cannot be held');
    }
    const pausing = hold === 'paused' && this.state.run.hold !== 'paused';
    this.state.run.hold = hold;
    if (!pausing) return;
    // A pause stops the running agents; their steps go on in the same session after it.
    const groups = [
      ...actionGroupsOf(this.state, 'before_split'),
      ...(this.state.split ? [this.state.split] : []),
      ...actionGroupsOf(this.state, 'after_split'),
      ...this.state.groups,
    ];
    for (const group of groups) {
      for (const attempt of group.attempts) {
        if (attempt.status !== 'running' || attempt.report !== null || attempt.reason !== null) {
          continue;
        }
        // A command cannot continue after a pause; it runs to its end.
        if (attempt.runtime === 'command') continue;
        attempt.reason = { kind: 'paused', at: this.now };
        this.effects.push({
          kind: 'stop_attempt',
          run: this.state.run.id,
          group: group.slug,
          seq: attempt.seq,
        });
      }
    }
    // A repair does not continue after a pause: its incident is taken again, and it is not counted.
    this.stopRepair({ reason: 'paused', refund: true });
  }

  private report(slug: string, seq: number, report: Report): void {
    const attempt = this.running(this.group(slug), seq);
    if (!attempt) throw new Rejection(`attempt ${seq} is not running`);
    if (attempt.reason?.kind === 'message') {
      throw new Rejection(`attempt ${seq} was interrupted by a message`);
    }
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
      ...(report.humanOnly ? { humanOnly: true } : {}),
    };
  }

  private proposeSplit(seq: number, groups: ProposedGroup[]): void {
    const split = this.state.split;
    const attempt = split ? this.running(split, seq) : undefined;
    if (!split || !attempt) throw new Rejection(`attempt ${seq} is not a running split step`);
    const maxGroups = runPipeline(this.state.run).split?.maxGroups ?? 1;
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
    if (attempt.reason?.kind === 'message') {
      this.continueAfterMessage(group, attempt, attempt.reason);
      return;
    }
    if (attempt.reason?.kind === 'paused') {
      if (attempt.report === null) {
        this.continueAfterPause(group, attempt);
        return;
      }
      // The report came before the stop: the exit failure is the stop itself.
      attempt.reason = null;
      exit = { ...exit, failure: null };
    }
    // A report sent before the limit ran out counts as usual.
    const limited = exit.failure?.kind === 'usage_limit' && attempt.report !== null;
    const failure = limited
      ? null
      : (exit.failure ?? (attempt.report === null ? { kind: 'no_report' } : null));
    if (failure !== null) {
      attempt.status = 'failed';
      attempt.reason = failure;
      if (
        failure.kind === 'usage_limit' &&
        (exit.onLimit ?? 'wait') === 'wait' &&
        !isRepairGroup(group)
      ) {
        this.waitForLimit(group, attempt);
        return;
      }
      this.failGroup(group, failure);
      return;
    }
    attempt.status = 'finished';
    const report = attempt.report as Report;
    const point = actionPointOf(group);
    const commitsToRun = point === 'before_split' || point === 'after_split';
    if (report.verdict === 'done' && commitsToRun) {
      this.effects.push({
        kind: 'commit',
        run: this.state.run.id,
        group: slug,
        stepId: attempt.stepId,
        summary: report.summary,
      });
    }
    if (report.verdict !== 'needs_human' && !isServiceGroup(group)) {
      this.effects.push({
        kind: 'commit',
        run: this.state.run.id,
        group: slug,
        stepId: attempt.stepId,
        summary: report.summary,
      });
    }
    if (
      exit.outsideChanges.length > 0 &&
      this.state.run.config.outsideChanges === 'stop' &&
      !isRepairGroup(group)
    ) {
      const files = exit.outsideChanges.join(', ');
      this.askHuman(
        group,
        attempt.stepIndex,
        `Files in your working copy changed while step ${attemptStepLabel(this.state, group, attempt)} ran: ${files}. The specialist, you or another program may have changed them; aip deliveries are not counted. Check your working copy and answer to continue.`,
        null,
      );
      return;
    }
    if (isRepairGroup(group)) this.finishRepair(group, report);
    else if (isResolveGroup(group)) this.finishResolve(group, report);
    else if (isActionGroup(group)) this.finishAction(group, attempt, report);
    else if (report.verdict === 'done' && isMessageGroup(group))
      this.finishMessage(group, report.summary);
    else if (report.verdict === 'done' && isSplitGroup(group)) this.finishSplit(group, attempt);
    else if (report.verdict === 'done') this.finishStep(group, attempt, report);
    else if (report.verdict === 'rejected') this.rejected(group, attempt, report.feedback ?? '');
    else {
      this.askHuman(
        group,
        attempt.stepIndex,
        report.feedback ?? '',
        report.questions ?? null,
        report.humanOnly ? 'request' : null,
      );
    }
  }

  /** `done` of an ordinary step: on to the next one, or first to a review by a person. */
  private finishStep(group: Group, attempt: Attempt, report: Report): void {
    const step = stepsOf(this.state.run, group)[attempt.stepIndex];
    if (step?.humanReview && !attempt.input.reviewed) {
      this.askHuman(
        group,
        attempt.stepIndex,
        reviewQuestion(attemptStepLabel(this.state, group, attempt), report.summary),
        null,
        'review',
      );
      return;
    }
    this.advance(group, attempt.stepIndex);
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
    // The groups wait in `queued` for the actions after the split.
    enterPoint(this.state, 'after_split');
  }

  /** A specialist reported on its pipeline action. */
  private finishAction(group: Group, attempt: Attempt, report: Report): void {
    if (report.verdict === 'done') {
      group.status = 'merged';
      group.pending = null;
      group.reason = null;
      return;
    }
    if (report.verdict === 'rejected') {
      const detail = (report.feedback ?? report.summary).trim();
      this.restorePending(group);
      group.status = 'failed';
      group.reason = `reported rejected${detail ? `: ${detail.split('\n')[0]}` : ''}`;
      return;
    }
    this.askHuman(
      group,
      attempt.stepIndex,
      report.feedback ?? '',
      report.questions ?? null,
      report.humanOnly ? 'request' : null,
    );
  }

  /** A command action ended; the daemon says how. */
  private actionFinished(slug: string, seq: number, outcome: ActionOutcome): void {
    const group = this.group(slug);
    const attempt = this.running(group, seq);
    if (!attempt) return;
    attempt.finishedAt = this.now;
    if (outcome.kind === 'exit' && outcome.code === 0) {
      attempt.status = 'finished';
      attempt.report = { verdict: 'done', summary: 'exit code 0', feedback: null };
      group.status = 'merged';
      group.pending = null;
      group.reason = null;
      const point = actionPointOf(group);
      if (point === 'before_split' || point === 'after_split') {
        this.effects.push({
          kind: 'commit',
          run: this.state.run.id,
          group: slug,
          stepId: attempt.stepId,
          summary: `action ${attempt.stepId}`,
        });
      }
      return;
    }
    const reason: FailReason =
      outcome.kind === 'exit'
        ? { kind: 'exit_code', code: outcome.code }
        : outcome.kind === 'timeout'
          ? { kind: 'timeout' }
          : { kind: 'spawn', message: outcome.message };
    attempt.status = 'failed';
    attempt.reason = reason;
    this.failGroup(group, reason);
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
      ...finishDelivery(
        this.state,
        {
          kind: 'failed',
          message: `the resolver reported ${report.verdict}${detail ? `: ${detail}` : ''}`,
        },
        this.now,
      ),
    );
  }

  /** The observer reported. A delivery repair is closed by the delivery that follows `done`. */
  private finishRepair(group: Group, report: Report): void {
    group.pending = null;
    const incident = this.state.run.repair.incident;
    const taken = incident ? [incident.key] : [];
    if (report.verdict === 'done') {
      group.status = 'merged';
      group.reason = null;
      if (this.state.run.pendingDelivery?.repair) {
        this.effects.push(...resolverDone(this.state));
        return;
      }
      closeRepair(this.state, { taken, refund: false });
      return;
    }
    const detail = (report.feedback ?? report.summary).trim();
    group.status = 'failed';
    group.reason = `observer reported ${report.verdict}${detail ? `: ${detail.split('\n')[0]}` : ''}`;
    if (this.state.run.pendingDelivery?.repair) {
      this.effects.push(
        ...finishDelivery(
          this.state,
          {
            kind: 'failed',
            message: `the observer reported ${report.verdict}${detail ? `: ${detail}` : ''}`,
          },
          this.now,
        ),
      );
      return;
    }
    closeRepair(this.state, { taken, refund: false });
  }

  private repairStart(incident: Incident, specialist: Specialist): void {
    const { run } = this.state;
    if (run.repair.incident !== null) throw new Rejection('a repair of this run is already going');
    if (run.hold !== null) throw new Rejection(`run is ${run.hold}; observers do not take it`);
    if (incident.kind === 'delivery') {
      if (run.pendingDelivery !== null) {
        throw new Rejection(`a delivery of run ${run.id} is already in progress`);
      }
      const groups = this.state.groups.filter(
        (group) => group.status === 'merged' && group.delivery.state === 'apply_failed',
      );
      if (groups.length === 0) throw new Rejection('no delivery to repair');
      run.repair.incident = incident;
      run.repair.specialist = specialist;
      run.repair.repairs += 1;
      run.pendingDelivery = {
        groups: groups.map((group) => group.slug),
        force: false,
        auto: false,
        round: 1,
        repair: true,
        message: renderCommitMessage(run.config.delivery.commitMessage, this.state, groups),
      };
      this.effects.push({
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
    openRepairGroup(this.state, repairTask(this.state, incident));
  }

  private repairAllowed(allowed: boolean): void {
    const { repair } = this.state.run;
    if (allowed === repair.allowed) return;
    repair.allowed = allowed;
    if (!allowed) {
      this.stopRepair({ reason: null, refund: false });
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
  private stopRepair(options: { reason: string | null; refund: boolean }): void {
    if (this.state.run.repair.incident === null) return;
    if (options.reason === 'paused') this.pausedRepair = true;
    const group = this.state.repair;
    if (group && !isTerminal(group.status)) {
      group.status = 'cancelled';
      group.pending = null;
      if (options.reason !== null) group.reason = options.reason;
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
    closeRepair(this.state, { taken: [], refund: options.refund });
  }

  private finishMessage(group: Group, summary: string | null): void {
    if (summary !== null) {
      group.status = 'merged';
      group.pending = null;
    }
    this.effects.push(...finishMessage(this.state, summary));
  }

  /**
   * Moves the pipeline after an event: a delivery waits for the actions before it, and the run is
   * cleaned up once the actions after delivery are done.
   */
  pipeline(wasDone: boolean): void {
    this.effects.push(...advanceChecks(this.state));
    if (!wasDone && afterDeliveryDone(this.state) && !this.state.run.config.delivery.keep) {
      this.effects.push({ kind: 'cleanup', run: this.state.run.id });
    }
  }

  autoDeliver(): void {
    // A check that failed or was cancelled stops the pipeline: only an explicit request starts it again.
    if (this.checksCancelled || pointStalled(this.state, 'before_delivery')) return;
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
        `Step \`${attemptStepLabel(this.state, group, attempt)}\` rejected the work ${rounds} times (limit ${onReject.maxRounds}). Last feedback:\n${feedback}`,
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
    humanOnly: HumanOnly | null = null,
  ): void {
    group.status = 'needs_human';
    group.question = question;
    group.questions = questions;
    group.humanOnly = humanOnly;
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
        ...(last.input.reviewed ? { reviewed: true } : {}),
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
      ...(attempt.input.reviewed ? { reviewed: true } : {}),
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
    if (isRepairGroup(group)) {
      // A crash, a timeout or an interruption: the incident is taken again; a usage limit gives
      // the repair back and does not wait.
      group.pending = null;
      closeRepair(this.state, { taken: [], refund: reason.kind === 'usage_limit' });
    }
    if (isResolveGroup(group)) {
      group.pending = null;
      this.effects.push(
        ...finishDelivery(
          this.state,
          {
            kind: 'failed',
            message: `the resolver failed: ${describeFailReason(reason)}`,
          },
          this.now,
        ),
      );
    }
  }

  private timedOut(slug: string, seq: number): void {
    const group = this.group(slug);
    const attempt = this.running(group, seq);
    if (!attempt || attempt.reason?.kind === 'message' || attempt.reason?.kind === 'paused') {
      return;
    }
    attempt.status = 'failed';
    attempt.reason = { kind: 'timeout' };
    attempt.finishedAt = this.now;
    this.effects.push({ kind: 'stop_attempt', run: this.state.run.id, group: slug, seq });
    this.failGroup(group, { kind: 'timeout' });
  }

  private message(slug: string, seq: number, text: string): void {
    const group = this.group(slug);
    const attempt = this.running(group, seq);
    if (!attempt) throw new Rejection(`attempt ${seq} is not running`);
    if (attempt.runtime === 'command') {
      throw new Rejection(`attempt ${seq} is a command; it takes no messages`);
    }
    if (attempt.report !== null) throw new Rejection(`attempt ${seq} already reported`);
    if (attempt.reason !== null) {
      throw new Rejection(`attempt ${seq} is already being interrupted`);
    }
    attempt.reason = { kind: 'message', text, at: this.now };
    this.effects.push({ kind: 'stop_attempt', run: this.state.run.id, group: slug, seq });
  }

  /** The attempt stopped because of a human message: the step goes on in the same session. */
  private continueAfterMessage(
    group: Group,
    attempt: Attempt,
    reason: { text: string; at: number },
  ): void {
    attempt.status = 'cancelled';
    attempt.finishedAt ??= this.now;
    group.pending = {
      ...freshPending(attempt.stepIndex),
      resume: true,
      message: { text: reason.text, at: reason.at },
      ...(attempt.input.reviewed ? { reviewed: true } : {}),
    };
    group.status = 'queued';
  }

  /** The attempt stopped because of a pause: the step goes on in the same session. */
  private continueAfterPause(group: Group, attempt: Attempt): void {
    attempt.status = 'cancelled';
    attempt.finishedAt ??= this.now;
    this.waitForLimit(group, attempt);
  }

  private cancel(only: string | null, reason?: string): void {
    if (only === REPAIR_GROUP && this.state.repair === null) {
      // The tree of a delivery repair is still being prepared: there is no group to cancel yet.
      this.stopRepair({ reason: null, refund: false });
      return;
    }
    const groups = only === null ? allGroups(this.state) : [this.group(only)];
    for (const group of groups) {
      // A failed action can be cancelled by name: that releases the pipeline held by it.
      const failedAction = only !== null && isActionGroup(group) && group.status === 'failed';
      if (isTerminal(group.status) && !failedAction) continue;
      group.status = 'cancelled';
      if (reason !== undefined) group.reason = reason;
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
    if (only === null || only === REPAIR_GROUP) {
      if (only === null && reason !== undefined) this.state.run.repair.cancelReason = reason;
      this.stopRepair({ reason: null, refund: false });
    }
    // Cancelling the whole run also cancels a delivery that waits for the checks, even when the
    // cancelled checks do not stop the pipeline.
    if (only === null && this.state.run.pendingDelivery?.checks) {
      cancelDelivery(this.state);
      this.checksCancelled = true;
    }
  }

  private stepSkip(step: string, skip: boolean): void {
    const { run } = this.state;
    const steps = groupPipeline(run.config, runPipeline(run)).steps;
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
      const error = checkSkip(run.config, run.pipeline, wanted);
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
        group.humanOnly = null;
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
    if (isRepairGroup(group)) {
      throw new Rejection(`group ${group.slug} is ${group.status}; observers take a repair again`);
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
      !isServiceGroup(group) &&
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
    by: 'human' | 'autopilot' | 'observer',
    permissions?: PermissionsRefresh,
  ): void {
    if (answer.trim() === '') throw new Rejection('answer must not be empty');
    const group = this.group(slug);
    if (group.status !== 'needs_human') throw wrongStatus(group, 'answer', 'needs_human');
    this.refresh(group, permissions);
    const last = group.attempts.at(-1);
    const asking = last && last.stepIndex === group.pending?.stepIndex ? last : undefined;
    const stepId =
      asking?.stepId ??
      group.attempts.find((candidate) => candidate.stepIndex === group.pending?.stepIndex)
        ?.stepId ??
      last?.stepId ??
      '';
    group.decisions.push({
      stepId,
      question: group.question ?? '',
      answer,
      by,
      ...(asking ? { attemptSeq: asking.seq } : {}),
    });
    group.status = 'queued';
    group.question = null;
    group.questions = null;
    if (group.pending) {
      group.pending.humanAnswer = answer;
      if (group.humanOnly === 'review') group.pending.reviewed = true;
    }
    group.humanOnly = null;
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
    if (deliveryCheckActive(this.state)) return;
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
        if (attempt.reason?.kind === 'message') {
          this.continueAfterMessage(group, attempt, attempt.reason);
          continue;
        }
        if (attempt.reason?.kind === 'paused') {
          this.continueAfterPause(group, attempt);
          continue;
        }
        attempt.status = 'failed';
        attempt.reason = { kind: 'interrupted' };
        attempt.finishedAt = this.now;
        wasRunning = true;
      }
      group.mergeInFlight = false;
      if (wasRunning) this.failGroup(group, { kind: 'interrupted' });
    }
    if (delivery?.repair) {
      // A repair delivery is not resumed: the incident is taken again.
      const group = this.state.repair;
      if (group && !isTerminal(group.status)) {
        group.status = 'failed';
        group.reason = 'interrupted';
        group.pending = null;
      }
      closeRepair(this.state, { taken: [], refund: false });
      return;
    }
    if (delivery?.checks) {
      if (pointStalled(this.state, 'before_delivery')) {
        for (const group of actionGroupsOf(this.state, 'before_delivery')) {
          if (group.status !== 'queued') continue;
          group.status = 'cancelled';
          group.reason = 'delivery interrupted';
        }
      } else {
        // The interrupted check may fail without stopping the pipeline: the delivery goes on
        // after the remaining checks, without entering the point (and running the command) again.
        this.state.run.pendingDelivery = delivery;
      }
    }
    // An interrupted action before delivery is not started again: the delivery waits for a new request.
    if (delivery && !delivery.checks && pointClosed(this.state, 'before_delivery')) {
      try {
        this.effects.push(
          ...requestDelivery(
            this.state,
            {
              groups: delivery.groups,
              force: delivery.force,
              files: delivery.files ?? [],
              auto: delivery.auto,
            },
            { resume: true },
          ),
        );
      } catch (error) {
        if (!(error instanceof Rejection)) throw error;
      }
    }
  }
}
