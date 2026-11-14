import type { ArtifactsPublishPort } from '../feature/artifacts/ports/index.ts';
import type { DeliveryPublishPort } from '../feature/delivery/ports/index.ts';
import type { NetworkChangedPort } from '../feature/network/ports/index.ts';
import type { ObserversPublishPort } from '../feature/observers/ports/index.ts';
import type { ProcessesPublishPort } from '../feature/processes/ports/index.ts';
import type { QueuePublishPort, RepairPolicyPort } from '../feature/queue/ports/index.ts';
import type { ReposPublishPort } from '../feature/repos/ports/index.ts';
import type {
  DiffPort,
  ObservePort,
  QueueAdvancePort,
  RunAttachmentsPort,
  RunsPublishPort,
} from '../feature/runs/ports/index.ts';
import type { ConfigChangedPort } from '../feature/swarm-edit/ports/index.ts';
import type { TagsPublishPort } from '../feature/tags/ports/index.ts';

/** A port that services get at construction and whose implementation is set after them. */
export interface LatePort<T extends object> {
  readonly port: T;
  set(implementation: T): void;
}

/**
 * Ports against the arrows of the feature graph: a feature below calls one above it or the
 * presentation, so the implementation exists only after the caller. Every port is set before the
 * daemon starts; `check` refuses to start with one left empty.
 */
export class Wiring {
  private readonly slots = new Map<string, { set: boolean }>();

  port<T extends object>(name: string): LatePort<T> {
    if (this.slots.has(name)) throw new Error(`port ${name} is declared twice`);
    const slot = { set: false };
    this.slots.set(name, slot);
    let implementation: T | null = null;
    const port = new Proxy({} as T, {
      get(_target, key) {
        if (implementation === null) throw new Error(`port ${name} is not wired`);
        const value = (implementation as Record<string | symbol, unknown>)[key];
        return typeof value === 'function' ? value.bind(implementation) : value;
      },
    });
    return {
      port,
      set(value: T) {
        implementation = value;
        slot.set = true;
      },
    };
  }

  /** Throws when a declared port has no implementation. */
  check(): void {
    const missing = [...this.slots].filter(([, slot]) => !slot.set).map(([name]) => name);
    if (missing.length > 0) throw new Error(`ports are not wired: ${missing.join(', ')}`);
  }
}

/** Every port against the arrows of the graph; `app` sets them once the services are built. */
export function declarePorts() {
  const wiring = new Wiring();
  const ports = {
    repos: wiring.port<ReposPublishPort>('repos.publish'),
    tags: wiring.port<TagsPublishPort>('tags.publish'),
    config: wiring.port<ConfigChangedPort>('swarm-edit.changed'),
    processes: wiring.port<ProcessesPublishPort>('processes.publish'),
    queue: wiring.port<QueueAdvancePort>('runs.queue'),
    observe: wiring.port<ObservePort>('runs.observe'),
    runs: wiring.port<RunsPublishPort>('runs.publish'),
    diff: wiring.port<DiffPort>('runs.diff'),
    attachments: wiring.port<RunAttachmentsPort>('runs.attachments'),
    delivery: wiring.port<DeliveryPublishPort>('delivery.publish'),
    artifacts: wiring.port<ArtifactsPublishPort>('artifacts.publish'),
    queuePublish: wiring.port<QueuePublishPort>('queue.publish'),
    repair: wiring.port<RepairPolicyPort>('queue.repair'),
    observers: wiring.port<ObserversPublishPort>('observers.publish'),
    network: wiring.port<NetworkChangedPort>('network.changed'),
  };
  return { wiring, ports };
}

export type Ports = ReturnType<typeof declarePorts>['ports'];
