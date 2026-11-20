import type { DaemonServices } from '../presentation/ipc/services.ts';
import type { Publisher } from '../presentation/ipc/publisher.ts';

import { integrationOperations } from './integration-operations.ts';
import type { Ports } from './wiring.ts';

/** Sets every port against the arrows: the publisher, the queue, the observers and the diffs. */
export function wire(ports: Ports, services: DaemonServices, publisher: Publisher): void {
  const publications = publisher.ports();
  ports.repos.set(publications.repos);
  ports.tags.set(publications.tags);
  // Settings of a runtime may have changed: observers look at the incidents again.
  ports.config.set({
    configChanged: (repository) => {
      publications.config.configChanged(repository);
      services.observers.request();
      // The queue mode is a setting of the shared settings.yaml.
      services.queue.scope.request();
      // The limits and the pools are settings of the same file: the waits and the free places are
      // looked at again, queued after the change of the mode, without a run event.
      const { engine } = services.runs;
      void engine.serial(() => engine.schedule()).catch(() => undefined);
    },
  });
  ports.integrations.set(integrationOperations(services));
  // The channels follow the connections; the notifications follow the runs.
  ports.integrationChanges.set(services.notifications.channels);
  ports.notify.set(services.notifications.dispatcher);
  ports.notifications.set(publications.notifications);
  ports.processes.set(publications.processes);
  // Every saved run reaches the clients first, then the usage journal.
  ports.runs.set({
    ...publications.runs,
    runSaved: (state) => {
      publications.runs.runSaved(state);
      void services.stats.ledger.capture(state);
    },
  });
  ports.queuePublish.set(publications.queue);
  ports.observers.set(publications.observers);
  ports.delivery.set(publications.delivery);
  ports.artifacts.set(publications.artifacts);
  // Agents held for the network start, and the clients hear about it, as soon as it changes.
  ports.network.set({
    changed: (state) => {
      publications.network.changed(state);
      const { engine } = services.runs;
      void engine.serial(() => engine.wake()).catch(() => undefined);
    },
  });
  // The server mode: a delivery commit is by the author of the run.
  ports.commits.set(services.delivery.commits);
  ports.push.set(services.delivery.push);
  ports.authors.set({
    byId: (id) => {
      const user = services.identity.users.byId(id);
      return user ? { name: user.name, email: user.email } : null;
    },
  });
  ports.attachments.set({ materialize: (run) => services.attachments.materialize(run) });
  ports.queue.set(services.queue.advance);
  ports.observe.set(services.observers);
  ports.repair.set(services.observers);
  ports.diff.set({
    savePatch: (state) => services.delivery.patches.save(state),
    refreshDiff: (state, slug) => services.delivery.diffs.refresh(state, slug),
  });
}
