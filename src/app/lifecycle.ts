import type { Database } from '../platform/sqlite/index.ts';
import type { DaemonServices } from '../presentation/ipc/services.ts';

/** The start and the stop of the daemon, in the order the services need. */
export interface Lifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createLifecycle(services: DaemonServices, database: Database): Lifecycle {
  const { network, runs, queue, tags, registry, observers, delivery, artifacts, processes } =
    services;
  return {
    async start() {
      network.start();
      await delivery.patches.sweep();
      await artifacts.sweep();
      await runs.engine.serial(async () => {
        const recovered = runs.states.recover();
        queue.store.load();
        tags.load();
        registry.load();
        observers.load();
        // A delivery cut off by the restart starts again.
        for (const { state, effects } of recovered) await runs.effects.perform(state, effects);
        await runs.engine.schedule();
        await queue.advance.resume();
        // Incidents from before the start, in finished runs too.
        await observers.observe(true);
      });
    },
    async stop() {
      runs.engine.halt();
      network.stop();
      processes.stop();
      await runs.engine.drain();
      database.close();
    },
  };
}
