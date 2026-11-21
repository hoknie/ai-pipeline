import { isAppError, rejected } from '../platform/errors/index.ts';
import { DUPLICATE_TASK_CODE } from '../feature/queue/types/index.ts';
import type { IntegrationOperationsPort } from '../feature/integrations/ports/index.ts';
import type { OperationResult } from '../feature/integrations/types/index.ts';
import type { DaemonServices } from '../presentation/ipc/services.ts';

/**
 * The domain operations a verified inbound event may ask for, routed to the services of the queue
 * and the runs. A run changes only through the event of its machine (`transition`, queued by the
 * service itself), and the queue only through its own service, one at a time like every other
 * request; nothing here waits for a network.
 */
export function integrationOperations(services: DaemonServices): IntegrationOperationsPort {
  const { runs, queue } = services;
  return {
    async perform(project, operation) {
      if (operation.type === 'queue_task') {
        return runs.engine.serial<OperationResult>(async () => {
          queue.scope.sync();
          try {
            const { item } = await queue.items.add({
              repository: project,
              pipeline: operation.pipeline,
              task: operation.task,
              createdBySystem: true,
              ...(operation.title === undefined ? {} : { title: operation.title }),
            });
            const queued: OperationResult = { queued: true, item };
            return queued;
          } catch (error) {
            if (
              operation.skipDuplicate === true &&
              isAppError(error) &&
              error.code === DUPLICATE_TASK_CODE
            ) {
              const skipped: OperationResult = { queued: false, duplicate: true };
              return skipped;
            }
            throw error;
          }
        });
      }
      if (runs.states.get(operation.runId).run.repository !== project) {
        throw rejected('the run belongs to another project');
      }
      await runs.requests.event(operation.runId, { kind: 'cancel', group: null });
      const cancelled: OperationResult = { cancelled: true, run: operation.runId };
      return cancelled;
    },
  };
}
