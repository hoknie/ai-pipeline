import type { ArtifactsPublishPort } from '../../feature/artifacts/ports/index.ts';
import type { DeliveryPublishPort } from '../../feature/delivery/ports/index.ts';
import type { NetworkChangedPort } from '../../feature/network/ports/index.ts';
import type { ObserversPublishPort } from '../../feature/observers/ports/index.ts';
import type { ProcessesPublishPort } from '../../feature/processes/ports/index.ts';
import type { QueuePublishPort } from '../../feature/queue/ports/index.ts';
import type { Queue } from '../../feature/queue/types/index.ts';
import type { ReposPublishPort } from '../../feature/repos/ports/index.ts';
import type { RunsPublishPort } from '../../feature/runs/ports/index.ts';
import type { RunState } from '../../feature/runs/types/index.ts';
import type { ConfigChangedPort } from '../../feature/swarm-edit/ports/index.ts';
import type { TagsPublishPort } from '../../feature/tags/ports/index.ts';
import type { QueueView } from './contract/index.ts';
import type { DaemonServices } from './services.ts';
import type { Snapshots } from './snapshots.ts';
import { catalogView } from './views/index.ts';

/** What subscribers of the `queue` event see: runs that occupy places and readiness of the items. */
function queueSignature(view: QueueView): string {
  return JSON.stringify({
    runs: view.runs,
    skipped: view.skipped,
    autoDeliver: view.autoDeliver,
    deliveryMode: view.deliveryMode,
    items: view.items.map((item) => [item.id, item.readiness, item.after, item.postponed]),
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
  private repositoriesJson = '';
  private observersJson = '';

  constructor(services: DaemonServices, snapshots: Snapshots) {
    this.services = services;
    this.snapshots = snapshots;
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
        },
      },
      queue: {
        queueSaved: (queue) => this.queue(queue),
        queueChecked: (queue) => this.queueChecked(queue),
      },
      repos: { repositoriesChanged: () => this.repositories() },
      tags: { tagsChanged: (repository) => this.tags(repository) },
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
    };
  }

  /**
   * A new subscriber gets the snapshot of the runs, queues, repositories and tags, then the last
   * list of background processes, then every event. Returns the function that unsubscribes.
   */
  subscribe(send: (line: string) => void): () => void {
    this.seq += 1;
    const runs = this.snapshots.recentRuns();
    const queues = this.snapshots.activeQueues();
    const repositories = this.snapshots.repositories();
    this.repositoriesJson = JSON.stringify(repositories);
    const tags = catalogView(this.services.tags.all());
    send(JSON.stringify({ event: 'snapshot', seq: this.seq, runs, queues, repositories, tags }));
    const processes = this.services.processes.lastSent();
    if (processes !== null) {
      this.seq += 1;
      send(JSON.stringify({ event: 'processes', seq: this.seq, processes }));
    }
    this.subscribers.add(send);
    this.services.processes.watch();
    return () => {
      this.subscribers.delete(send);
      if (this.subscribers.size === 0) this.services.processes.unwatch();
    };
  }

  /** The `run` event. */
  run(state: RunState): void {
    if (this.subscribers.size === 0) return;
    this.send('run', { run: this.snapshots.run(state) });
  }

  /** Sends the `queue` event and remembers which runs subscribers have seen. */
  queue(queue: Queue): void {
    const view = this.snapshots.queue(queue);
    this.queueRuns.set(queue.repository, queueSignature(view));
    this.send('queue', { queue: view });
    this.repositories();
    this.returned(queue);
  }

  /** Sends the queue when it looks different to the subscribers. */
  queueChecked(queue: Queue): void {
    const seen = this.queueRuns.get(queue.repository);
    if (seen !== queueSignature(this.snapshots.queue(queue))) this.queue(queue);
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
