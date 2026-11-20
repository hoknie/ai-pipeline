import { REGISTRY_PATH_LIMIT } from '../../../../feature/service-registry/types/index.ts';
import { SECRET_LIMIT, SLOT_PATTERN } from '../../../../feature/integrations/types/index.ts';
import { queueRepository } from '../queue.ts';
import { z } from 'zod';

import type { LinkStatus } from '../../../../feature/service-registry/types/index.ts';
import type { ConnectionView as BaseConnectionView } from '../../../../feature/integrations/types/index.ts';
import type { ChannelStateView } from '../notifications/notifications.ts';

export type { CatalogEntry as IntegrationTypeView } from '../../../../feature/integrations/types/index.ts';

/** A connection as the clients see it: the registry view and, for a channel, how it works now. */
export interface ConnectionView extends BaseConnectionView {
  /** The state of the listener of a channel connection; null when there is none. */
  channel: ChannelStateView | null;
}

/** A skill of a service registry as `integration_skills` lists it. */
export type { RegistrySkill as RegistrySkillView } from '../../../../feature/service-registry/types/index.ts';
/** A link of a project of aip to a project of a service registry, or why there is none. */
export interface ProjectLinkView {
  /** The root of the project of aip. */
  project: string;
  connection: string;
  connectionName: string;
  registryPath: string | null;
  source: 'auto' | 'manual' | null;
  status: LinkStatus;
  candidates: string[];
  matchedAt: number;
  /** The page of the web interface of the registry that shows the project; null without a link. */
  url: string | null;
}

/** The answer of `integration_remove`: the connection and its secrets are gone. */
export interface IntegrationRemoved {
  removed: string;
}

const connectionId = z.string().min(1).max(64);
const slot = z.string().regex(SLOT_PATTERN);
const parameters = z.record(z.string().min(1).max(64), z.string().max(1000));

/**
 * The methods that manage connections and their secrets. The panel carries all of them except
 * `integration_secret_set` and `integration_secret_remove`, which only the local CLI uses: no MCP
 * tool and no HTTP route carries them, so no specialist and no browser can read or change a
 * secret through the daemon.
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
  z.object({
    method: z.literal('integration_edit'),
    params: z.object({
      id: connectionId,
      set: parameters.optional(),
      unset: z.array(z.string().min(1).max(64)).max(50).optional(),
    }),
  }),
  z.object({ method: z.literal('integration_remove'), params: z.object({ id: connectionId }) }),
  z.object({ method: z.literal('integration_enable'), params: z.object({ id: connectionId }) }),
  z.object({ method: z.literal('integration_disable'), params: z.object({ id: connectionId }) }),
  z.object({ method: z.literal('integration_check'), params: z.object({ id: connectionId }) }),
  z.object({
    method: z.literal('integration_skills'),
    params: z
      .object({
        id: connectionId.optional(),
        repository: queueRepository.optional(),
        query: z.string().max(200).optional(),
      })
      .refine((params) => (params.id === undefined) !== (params.repository === undefined), {
        message: 'pass either a connection id or a repository',
      }),
  }),
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
  z.object({
    method: z.literal('integration_link'),
    params: z
      .object({
        /** The id of the connection, or its name when the project has one registry of that name. */
        id: z.string().min(1).max(80),
        repository: queueRepository,
        path: z.string().min(1).max(REGISTRY_PATH_LIMIT).optional(),
        auto: z.literal(true).optional(),
        clear: z.literal(true).optional(),
      })
      .refine(
        (params) =>
          [params.path, params.auto, params.clear].filter((one) => one !== undefined).length === 1,
        { message: 'pass exactly one of path, auto and clear' },
      ),
  }),
  z.object({
    method: z.literal('integration_links'),
    params: z.object({ repository: queueRepository.optional() }).default({}),
  }),
] as const;
