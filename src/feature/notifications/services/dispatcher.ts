import { allGroups, type RunState } from '../../runs/types/index.ts';
import { notificationEvents, type Delivery } from '../types/index.ts';

import { QuestionCloser, type RunSnapshot } from './closer.ts';
import type { OutboxDependencies } from './outbox.ts';
import { Lanes } from './lanes.ts';
import { DeliverySender } from './sender.ts';

export interface DispatcherDependencies extends OutboxDependencies {
  /** Every run the daemon knows: looked at once at the start, for what happened while it was off. */
  states: () => RunState[];
  /** Forgets the inbound claims older than the moment given. */
  pruneClaims: (before: number) => number;
  /** How long a finished delivery stays in the journal. */
  retentionMs?: number;
}

const DAY_MS = 86_400_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

export function snapshotOf(state: RunState): RunSnapshot {
  return {
    run: state.run.id,
    events: notificationEvents(state),
    groups: new Map(
      allGroups(state).map((group) => [
        group.slug,
        {
          status: group.status,
          decisions: group.decisions.length,
          by: group.decisions.at(-1)?.by ?? null,
        },
      ]),
    ),
  };
}

/**
 * From the events of the runs to the messages in the chats. Taking the events is quick and only
 * touches the database; every call to a network goes through a lane of its own, so a slow channel
 * never holds the queue of changes of the runs.
 */
export class NotificationDispatcher {
  private readonly dependencies: DispatcherDependencies;
  private readonly sender: DeliverySender;
  private readonly closer: QuestionCloser;
  /** Plans: records the events and sees which questions closed. */
  private plans: Promise<void> = Promise.resolve();
  /** Looks for what is due and redraws messages; the sending itself runs in the lanes below. */
  private network: Promise<void> = Promise.resolve();
  /** Per connection: a chat sends one message at a time, a webhook several. */
  private readonly lanes = new Lanes();
  /** The deliveries being sent now, by id. */
  private readonly flying = new Map<number, Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(dependencies: DispatcherDependencies) {
    this.dependencies = dependencies;
    this.sender = new DeliverySender(dependencies);
    this.closer = new QuestionCloser(dependencies);
  }

  runChanged(state: RunState): void {
    if (this.stopped) return;
    const snapshot = snapshotOf(state);
    this.plans = this.plans
      .then(() => this.plan(snapshot))
      .catch((error: unknown) => this.fail(error));
  }

  /** Looks at every run again: after a subscription changed, and once at the start. */
  resync(): void {
    for (const state of this.dependencies.states()) this.runChanged(state);
  }

  /** The start: what happened while the daemon was off, the retries that waited, the cleanup. */
  async start(): Promise<void> {
    this.stopped = false;
    this.dependencies.outcomes.failInterruptedTests(this.dependencies.now());
    this.prune();
    if (this.pruneTimer !== null) clearInterval(this.pruneTimer);
    this.pruneTimer = setInterval(() => this.prune(), DAY_MS);
    this.pruneTimer.unref();
    // A run that finished before the journal's retention has nothing new to say: its events may
    // have been cleared from the journal already, and must not come back as new.
    const { now, retentionMs } = this.dependencies;
    const horizon = now() - (retentionMs ?? 30 * DAY_MS);
    for (const state of this.dependencies.states()) {
      if (state.run.finishedAt === null || state.run.finishedAt >= horizon) this.runChanged(state);
    }
    this.queueFlush();
    await this.idle();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.pruneTimer !== null) clearInterval(this.pruneTimer);
    this.timer = null;
    this.pruneTimer = null;
    await this.idle();
  }

  /** Starts sending what is due now, without waiting for it. */
  wake(): void {
    this.queueFlush();
  }

  /** Sends what is due now and waits for it. */
  flush(): Promise<void> {
    this.queueFlush();
    return this.idle();
  }

  /** Resolves when everything taken so far has been planned and sent. */
  async idle(): Promise<void> {
    for (;;) {
      const [plans, network, flying] = [this.plans, this.network, [...this.flying.values()]];
      await Promise.all([plans, network, ...flying]);
      if (plans === this.plans && network === this.network && this.flying.size === 0) return;
    }
  }

  test(subscription: string) {
    return this.sender.test(subscription);
  }

  /** Records the events for the subscriptions and closes the questions that are no longer open. */
  private plan(snapshot: RunSnapshot): void {
    const { subscriptions, deliveries, publish, now } = this.dependencies;
    let created = false;
    for (const event of snapshot.events) {
      for (const subscription of subscriptions.matching(event)) {
        const delivery = deliveries.claim(
          {
            subscriptionId: subscription.id,
            eventKey: event.key,
            kind: event.kind,
            run: event.run,
            group: event.group,
            questionKey: event.kind === 'question' ? event.key : null,
            payload: event.data,
          },
          now(),
        );
        if (delivery === null) continue;
        created = true;
        publish.journalChanged(delivery.id);
      }
    }
    for (const delivery of deliveries.ofRun(snapshot.run, ['pending', 'sent'])) {
      if (delivery.kind !== 'question') continue;
      if (snapshot.events.some((event) => event.key === delivery.eventKey)) continue;
      const closed = this.closer.close(delivery, snapshot);
      if (closed.redraw) this.enqueue(() => this.closer.refresh(delivery.id));
      if (closed.announced) created = true;
    }
    if (created) this.queueFlush();
  }

  private queueFlush(): void {
    this.enqueue(() => this.sendDue());
  }

  private enqueue(job: () => Promise<void>): void {
    this.network = this.network.then(job).catch((error: unknown) => this.fail(error));
  }

  /** Starts what is due; does not wait for the network, so a slow receiver holds nobody. */
  private sendDue(): Promise<void> {
    const { deliveries, now } = this.dependencies;
    for (let round = 0; round < 50 && !this.stopped; round += 1) {
      const due = deliveries.due(now(), 50).filter((one) => !this.flying.has(one.id));
      if (due.length === 0) break;
      for (const delivery of due) this.launch(delivery);
    }
    this.arm();
    return Promise.resolve();
  }

  private launch(delivery: Delivery): void {
    const { subscriptions, channels } = this.dependencies;
    const connection = subscriptions
      .all()
      .find((one) => one.id === delivery.subscriptionId)?.connectionId;
    const key = connection ?? `subscription:${delivery.subscriptionId}`;
    const limit = connection === undefined ? 1 : channels.policyOf(connection).concurrency;
    const job = this.lanes
      .run(key, limit, () => (this.stopped ? Promise.resolve() : this.sender.deliver(delivery)))
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.flying.delete(delivery.id);
        this.queueFlush();
      });
    this.flying.set(delivery.id, job);
  }

  /** Sets the timer to the earliest pending delivery. */
  private arm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped) return;
    const { deliveries, now } = this.dependencies;
    const next = deliveries.nextAttemptAt();
    if (next === null) return;
    this.timer = setTimeout(
      () => this.queueFlush(),
      Math.min(Math.max(next - now(), 0), MAX_TIMER_MS),
    );
    this.timer.unref();
  }

  private prune(): void {
    const { outcomes, pruneClaims, now, retentionMs, log } = this.dependencies;
    const before = now() - (retentionMs ?? 30 * DAY_MS);
    try {
      outcomes.prune(before);
      pruneClaims(before);
    } catch (error) {
      log(`notifications: cannot clear the journal: ${String(error)}`);
    }
  }

  private fail(error: unknown): void {
    this.dependencies.log(`notifications: ${String(error)}`);
  }
}
