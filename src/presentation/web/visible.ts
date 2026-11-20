type Event = Record<string, unknown>;

/** The projects (roots) a subscriber reads; `null`: all of them. */
export type Allowed = ReadonlySet<string> | null;

const field = (value: unknown, name: string): string | null => {
  const found = (value as Record<string, unknown> | null | undefined)?.[name];
  return typeof found === 'string' ? found : null;
};

function keep<T>(items: unknown, allowed: ReadonlySet<string>, name: string): T[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    const project = field(item, name);
    return project !== null && allowed.has(project);
  }) as T[];
}

function globalQueueOf(queue: unknown, allowed: ReadonlySet<string>): unknown {
  if (queue === null || typeof queue !== 'object') return queue;
  const view = queue as Record<string, unknown>;
  return {
    ...view,
    items: keep(view.items, allowed, 'repository'),
    runs: keep(view.runs, allowed, 'repository'),
    skipped: keep(view.skipped, allowed, 'repository'),
  };
}

function snapshotFor(event: Event, allowed: ReadonlySet<string>): Event {
  const out: Event = {
    ...event,
    runs: keep(event.runs, allowed, 'repository'),
    queues: keep(event.queues, allowed, 'repository'),
    repositories: keep(event.repositories, allowed, 'path'),
    tags: keep(event.tags, allowed, 'repository'),
  };
  if (event.globalQueue !== undefined) out.globalQueue = globalQueueOf(event.globalQueue, allowed);
  return out;
}

function observersFor(event: Event, allowed: ReadonlySet<string>): Event {
  const view = event.observers as { workers?: { running?: unknown } } | undefined;
  if (!view?.workers) return event;
  return {
    ...event,
    observers: {
      ...view,
      workers: { ...view.workers, running: keep(view.workers.running, allowed, 'repository') },
    },
  };
}

/**
 * What a subscriber with the given readable projects gets of an event of the daemon: the event as
 * it is, the event without what belongs to other projects, or `null` when it is all about another
 * project.
 */
export function eventFor(event: Event, allowed: Allowed): Event | null {
  if (allowed === null) return event;
  switch (event.event) {
    case 'snapshot':
      return snapshotFor(event, allowed);
    case 'run': {
      const project = field(event.run, 'repository');
      return project !== null && allowed.has(project) ? event : null;
    }
    case 'queue': {
      const project = field(event.queue, 'repository');
      return project !== null && allowed.has(project) ? event : null;
    }
    case 'globalQueue':
      return { ...event, globalQueue: globalQueueOf(event.globalQueue, allowed) };
    case 'repositories':
      return { ...event, repositories: keep(event.repositories, allowed, 'path') };
    case 'tags': {
      const project = field(event, 'repository');
      if (project !== null) return allowed.has(project) ? event : null;
      return { ...event, tags: keep(event.tags, allowed, 'repository') };
    }
    case 'observers':
      return observersFor(event, allowed);
    case 'processes': {
      const processes = Array.isArray(event.processes) ? event.processes : undefined;
      if (processes === undefined) return event;
      const readable = processes.filter((item) => {
        const project = field((item as { owner?: unknown }).owner, 'repository');
        return project !== null && allowed.has(project);
      });
      return { ...event, processes: readable };
    }
    default:
      return event;
  }
}
