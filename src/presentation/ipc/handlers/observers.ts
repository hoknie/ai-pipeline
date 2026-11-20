import type { ObserversSetResult } from '../contract/index.ts';
import type { HandlerTable } from './types.ts';
import { visible } from './access/visible.ts';
import { observerHistoryView } from '../views/observer-history.ts';

/** The settings of the observers and the actions of an observer on its run. */
export const observerHandlers = {
  observers_history: async (params, context) => {
    const view = observerHistoryView(context.services.history.page(params));
    return { ...view, items: visible(context, view.items, (item) => item.repository) };
  },
  observers: async (_params, context) => {
    const view = context.snapshots.observers();
    const running = visible(context, view.workers.running, (worker) => worker.repository);
    return { ...view, workers: { ...view.workers, running } };
  },
  observers_set: (params, { services, snapshots }): Promise<ObserversSetResult> =>
    services.runs.engine.serial(async () => {
      const result = await services.observers.set(params.settings);
      return result.ok
        ? { ok: true as const, view: snapshots.observers() }
        : { ok: false as const, reason: 'invalid' as const, errors: result.errors };
    }),
  repair_action: (params, { services }) => services.observers.repairAction(params),
} satisfies Partial<HandlerTable>;
