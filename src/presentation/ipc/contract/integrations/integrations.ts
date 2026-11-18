import { SECRET_LIMIT, SLOT_PATTERN } from '../../../../feature/integrations/types/index.ts';
import { queueRepository } from '../queue.ts';
import { z } from 'zod';

export type {
  CatalogEntry as IntegrationTypeView,
  ConnectionView,
} from '../../../../feature/integrations/types/index.ts';

/** The answer of `integration_remove`: the connection and its secrets are gone. */
export interface IntegrationRemoved {
  removed: string;
}

const connectionId = z.string().min(1).max(64);
const slot = z.string().regex(SLOT_PATTERN);
const parameters = z.record(z.string().min(1).max(64), z.string().max(1000));

/**
 * The methods that manage connections and their secrets. Only the local CLI uses them: no MCP
 * tool and no HTTP route of the panel carries them, so no specialist and no browser can read or
 * change a secret through the daemon.
 */
export const integrationsRequests = [
  z.object({ method: z.literal('integration_types'), params: z.object({}).default({}) }),
  z.object({
    method: z.literal('integration_list'),
    params: z.object({ repository: queueRepository.optional() }).default({}),
  }),
  z.object({
    method: z.literal('integration_add'),
    params: z.object({
      kind: z.string().min(1).max(40),
      name: z.string().min(1).max(80),
      repository: queueRepository.optional(),
      global: z.boolean().optional(),
      params: parameters.optional(),
    }),
  }),
  z.object({ method: z.literal('integration_remove'), params: z.object({ id: connectionId }) }),
  z.object({ method: z.literal('integration_enable'), params: z.object({ id: connectionId }) }),
  z.object({ method: z.literal('integration_disable'), params: z.object({ id: connectionId }) }),
  z.object({
    method: z.literal('integration_secret_set'),
    params: z.object({
      id: connectionId,
      slot,
      value: z.string().min(1).max(SECRET_LIMIT),
    }),
  }),
  z.object({
    method: z.literal('integration_secret_remove'),
    params: z.object({ id: connectionId, slot }),
  }),
] as const;
