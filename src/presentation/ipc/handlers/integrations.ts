import { failureCode, refusal } from '../../../feature/integrations/types/index.ts';

import type { HandlerTable } from './types.ts';

/**
 * Every failure of these handlers leaves as one of the fixed refusals of the integrations: an
 * error of a service, of the registry or of the secret store may carry a value or a path, and
 * is replaced by a static text here.
 */
async function guarded<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw failureCode(error) === null ? refusal('internal') : error;
  }
}

/** Connections to external systems and their secrets: managed from the local CLI only. */
export const integrationHandlers = {
  integration_types: (_params, { services }) =>
    guarded(() => services.integrations.connections.types()),
  integration_list: (params, { services }) =>
    guarded(() => services.integrations.connections.list(params.repository)),
  integration_add: (params, { services }) =>
    guarded(() => services.integrations.connections.add(params)),
  integration_remove: (params, { services }) =>
    guarded(async () => {
      await services.integrations.connections.remove(params.id);
      return { removed: params.id };
    }),
  integration_enable: (params, { services }) =>
    guarded(() => services.integrations.connections.enable(params.id)),
  integration_disable: (params, { services }) =>
    guarded(() => services.integrations.connections.disable(params.id)),
  integration_secret_set: (params, { services }) =>
    guarded(() =>
      services.integrations.connections.setSecret(params.id, params.slot, params.value),
    ),
  integration_secret_remove: (params, { services }) =>
    guarded(() => services.integrations.connections.removeSecret(params.id, params.slot)),
} satisfies Partial<HandlerTable>;
