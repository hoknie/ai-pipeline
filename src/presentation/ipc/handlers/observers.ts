import type { HandlerTable } from './types.ts';

/** The settings of the observers and the actions of an observer on its run. */
export const observerHandlers = {
  observers: async (_params, { snapshots }) => snapshots.observers(),
  observers_set: (params, { services, snapshots }) =>
    services.runs.engine.serial(async () => {
      const result = await services.observers.set(params.settings);
      return result.ok ? { ok: true as const, observers: snapshots.observers() } : result;
    }),
  repair_action: (params, { services }) => services.observers.repairAction(params),
} satisfies Partial<HandlerTable>;
