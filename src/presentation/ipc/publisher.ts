import type { ArtifactsPublishPort } from '../../feature/artifacts/ports/index.ts';
import type { DeliveryPublishPort } from '../../feature/delivery/ports/index.ts';
import type { NetworkChangedPort } from '../../feature/network/ports/index.ts';
import type { NotificationsPublishPort } from '../../feature/notifications/ports/index.ts';
import type { ObserversPublishPort } from '../../feature/observers/ports/index.ts';
import type { ProcessesPublishPort } from '../../feature/processes/ports/index.ts';
import type { QueuePublishPort } from '../../feature/queue/ports/index.ts';
import type { Queue } from '../../feature/queue/types/index.ts';
import type { ReposPublishPort } from '../../feature/repos/ports/index.ts';
import type { RunsPublishPort } from '../../feature/runs/ports/index.ts';
import type { RunState } from '../../feature/runs/types/index.ts';
import type { ConfigChangedPort } from '../../feature/swarm-edit/ports/index.ts';
import type { TagsPublishPort } from '../../feature/tags/ports/index.ts';
import type { GlobalQueueView, QueueView } from './contract/index.ts';
import { LogSignals } from './log-signals.ts';
import type { DaemonServices } from './services.ts';
import type { Snapshots } from './snapshots.ts';
import { catalogView, channelView } from './views/index.ts';

/** What subscribers of the `queue` event see: runs that occupy places and readiness of the items. */
function queueSignature(view: QueueView): string {
  return JSON.stringify({
    runs: view.runs,
    skipped: view.skipped,
    autoDeliver: view.autoDeliver,
    deliveryMode: view.deliveryMode,
    items: view.items.map((item) => [
      ...[item.id, item.readiness, item.after, item.postponed],
      ...[item.links, item.linkedBy, item.deliveryBranch],
    ]),
  });
}

/** What subscribers of the `globalQueue` event see: places, readiness and order of the tasks. */
function globalSignature(view: GlobalQueueView | null): string {
  if (view === null) return 'project';
  return JSON.stringify({
    status: view.status,
    stop: view.stop,
    runs: view.runs,
    skipped: view.skipped,
    items: view.items.map((item) => [
      ...[item.id, item.readiness, item.after, item.postponed],
      ...[item.links, item.linkedBy, item.deliveryBranch],
      item.filtered,
      item.tags,
    ]),
  });
}

/** Every publication port the features declare, implemented by the publisher. */
export interface PublicationPorts {
  runs: RunsPublishPort;
  queue: QueuePublishPort;
  repos: ReposPublishPort;
  tags: TagsPublishPort;
  config: ConfigChangedPort;
  processes: ProcessesPublishPort;
  observers: ObserversPublishPort;
  delivery: DeliveryPublishPort;
  artifacts: ArtifactsPublishPort;
  network: NetworkChangedPort;
  notifications: NotificationsPublishPort;
}

/** The subscribers of the daemon and the one counter of the events they get. */
export class Publisher {
  private readonly services: DaemonServices;
  private readonly snapshots: Snapshots;
  private readonly subscribers = new Set<(line: string) => void>();
  private seq = 0;
  /** The signature of each queue as subscribers last saw it. */
  private readonly queueRuns = new Map<string, string>();
  /** Per repository: return item of each returned run, as subscribers last saw it. */
  private readonly returnItems = new Map<string, Map<string, string>>();
  /** The signature of the global queue as subscribers last saw it. */
  private globalSeen = 'project';
  private repositoriesJson = '';
  private observersJson = '';
  private readonly logs: LogSignals;

  constructor(services: DaemonServices, snapshots: Snapshots) {
    this.services = services;
    this.snapshots = snapshots;
    this.logs = new LogSignals(services.now, () => (this.seq += 1));
  }

  /** The ports of the features, each a view of this publisher. */
  ports(): PublicationPorts {
    const runChanged = (state: RunState): void => this.run(state);
    return {
      runs: {
        runSaved: (state) => {
          this.run(state);
          this.repositories();
        },
        waitsChanged: (states, repositories) => {
          for (const state of states) this.run(state);
          for (const repository of repositories) {
            const queue = this.services.queue.store.get(repository);
            if (queue) this.queueChecked(queue);
          }
          if (this.services.queue.store.scope() === 'global') this.globalQueue(false);
        },
        logGrew: (attempt) => this.logs.grew(attempt),
      },
      queue: {
        queueSaved: (queue) => this.queue(queue),
        queueChecked: (queue) => this.queueChecked(queue),
        runChanged,
        globalQueueSaved: () => this.globalQueue(true),
        globalQueueChecked: () => this.globalQueue(false),
      },
      repos: { repositoriesChanged: () => this.repositories() },
      tags: {
        tagsChanged: (repository) => {
          this.tags(repository);
          if (this.services.queue.store.scope() === 'global') {
            this.globalQueue(false);
            this.services.queue.advance.request(repository);
          }
        },
      },
      // Configuration may change `delivery.auto`, which the queue view shows.
      config: {
        configChanged: (repository) => {
          const queue = this.services.queue.store.get(repository);
          if (queue) this.queue(queue);
        },
      },
      processes: {
        hasSubscribers: () => this.subscribers.size > 0,
        processesChanged: (payload) => this.send('processes', payload),
      },
      observers: {
        incident: (state, incident) =>
          this.send('incident', {
            runId: state.run.id,
            repository: state.run.repository,
            incident,
          }),
        observersChanged: () => this.observers(),
        runChanged,
      },
      delivery: { runChanged },
      artifacts: { runChanged },
      network: { changed: () => this.send('network', { network: this.services.network.status() }) },
      notifications: {
        subscriptionsChanged: () => this.send('notifications', { change: 'subscriptions' }),
        journalChanged: (delivery) => this.send('notifications', { change: 'journal', delivery }),
        channelChanged: (connection, status) =>
          this.send('notifications', {
            change: 'channel',
            connection,
            channel: status === null ? null : channelView(status),
          }),
      },
    };
  }

  /**
   * A new subscriber gets the snapshot of the runs, queues, repositories and tags, then the last
   * list of background processes, then every event; with `logs` also the `log` events of the
   * attempts. Returns the function that unsubscribes.
   */
  subscribe(send: (line: string) => void, logs = false): () => void {
    this.seq += 1;
    const runs = this.snapshots.recentRuns();
    const queues = this.snapshots.activeQueues();
    const repositories = this.snapshots.repositories();
    this.repositoriesJson = JSON.stringify(repositories);
    const tags = catalogView(this.services.tags.all());
    const globalQueue = this.currentGlobal();
    this.globalSeen = globalSignature(globalQueue);
    send(
      JSON.stringify({
        event: 'snapshot',
        seq: this.seq,
        runs,
        queues,
        repositories,
        tags,
        ...(globalQueue === null ? {} : { globalQueue }),
      }),
    );
    const processes = this.services.processes.lastSent();
    if (processes !== null) {
      this.seq += 1;
      send(JSON.stringify({ event: 'processes', seq: this.seq, processes }));
    }
    this.subscribers.add(send);
    this.services.processes.watch();
    const dropLogs = logs ? this.logs.add(send) : null;
    return () => {
      dropLogs?.();
      this.subscribers.delete(send);
      if (this.subscribers.size === 0) this.services.processes.unwatch();
    };
  }

  /** The `run` event. */
  run(state: RunState): void {
    if (this.subscribers.size === 0) return;
    this.send('run', { run: this.snapshots.run(state) });
    this.logs.runChanged(state);
    // The queues of other projects that wait for this run show its new state.
    for (const waiting of this.services.queue.store.lines.waitingFor(
      state.run.id,
      state.run.repository,
    )) {
      this.queueChecked(waiting);
    }
  }

  /** Sends the `queue` event and remembers which runs subscribers have seen. */
  queue(queue: Queue): void {
    const view = this.snapshots.queue(queue);
    this.queueRuns.set(queue.repository, queueSignature(view));
    this.send('queue', { queue: view });
    this.repositories();
    this.returned(queue);
    // The queues of other projects whose items wait for an item of this queue show its changes.
    const waiting = new Map<string, Queue>();
    for (const item of queue.items)
      for (const other of this.services.queue.store.lines.waitingFor(item.id, queue.repository))
        waiting.set(other.repository, other);
    for (const other of waiting.values()) this.queueChecked(other);
  }

  /** Sends the queue when it looks different to the subscribers. */
  queueChecked(queue: Queue): void {
    const seen = this.queueRuns.get(queue.repository);
    if (seen !== queueSignature(this.snapshots.queue(queue))) this.queue(queue);
  }

  /** The global queue in the global mode; null in the project mode. */
  private currentGlobal(): GlobalQueueView | null {
    return this.services.queue.store.scope() === 'global' ? this.snapshots.globalQueue() : null;
  }

  /**
   * Sends the `globalQueue` event: after a save, or when the queue looks different to subscribers.
   * When the mode goes back to `project` the event carries `null` once.
   */
  globalQueue(saved: boolean): void {
    if (this.subscribers.size === 0) return;
    const view = this.currentGlobal();
    const signature = globalSignature(view);
    if (!saved && signature === this.globalSeen) return;
    if (view === null && this.globalSeen === 'project') return;
    this.globalSeen = signature;
    this.send('globalQueue', { globalQueue: view });
    this.repositories();
  }

  /** Publishes the registry when its counters or entries differ from what subscribers last saw. */
  repositories(): void {
    if (this.subscribers.size === 0) return;
    const repositories = this.snapshots.repositories();
    const text = JSON.stringify(repositories);
    if (text === this.repositoriesJson) return;
    this.repositoriesJson = text;
    this.send('repositories', { repositories });
  }

  /** Publishes the observers when they look different from what subscribers last saw. */
  observers(): void {
    if (this.subscribers.size === 0) return;
    const view = this.snapshots.observers();
    const text = JSON.stringify(view);
    if (text === this.observersJson) return;
    this.observersJson = text;
    this.send('observers', { observers: view });
  }

  /** Publishes all tags after a change of the catalog of the repository. */
  tags(repository: string): void {
    this.send('tags', { repository, tags: catalogView(this.services.tags.all()) });
  }

  /** Sends a `run` event to every run whose return item appeared, changed or went away. */
  private returned(queue: Queue): void {
    const before = this.returnItems.get(queue.repository) ?? new Map<string, string>();
    const after = new Map<string, string>();
    for (const item of queue.items) if (item.run !== null) after.set(item.run, item.id);
    this.returnItems.set(queue.repository, after);
    for (const run of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(run) === after.get(run)) continue;
      const state = this.services.runs.states.lookup(run);
      if (state) this.run(state);
    }
  }

  /** One event with the next number; nothing is counted without subscribers. */
  private send(event: string, payload: object): void {
    if (this.subscribers.size === 0) return;
    this.seq += 1;
    const line = JSON.stringify({ event, seq: this.seq, ...payload });
    for (const send of this.subscribers) send(line);
  }
}
