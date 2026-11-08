import type { ObserversSetResult } from '../contract/index.ts';
import type { HandlerTable } from './types.ts';

/** The settings of the observers and the actions of an observer on its run. */
export const observerHandlers = {
  observers: async (_params, { snapshots }) => snapshots.observers(),
  observers_set: (params, { services, snapshots }): Promise<ObserversSetResult> =>
    services.runs.engine.serial(async () => {
      const result = await services.observers.set(params.settings);
      return result.ok
        ? { ok: true as const, view: snapshots.observers() }
        : { ok: false as const, reason: 'invalid' as const, errors: result.errors };
    }),
  repair_action: (params, { services }) => services.observers.repairAction(params),
} satisfies Partial<HandlerTable>;
