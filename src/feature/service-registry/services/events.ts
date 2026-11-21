import { isAppError } from '../../../platform/errors/index.ts';
import type {
  ConnectionAccess,
  InboundVerifierPort,
  VerifyContext,
} from '../../integrations/services/index.ts';
import type { LinkRepository } from '../repositories/index.ts';
import {
  REGISTRY_PATH_LIMIT,
  WEBHOOK_SECRET_SLOT,
  registryBase,
  ruleOf,
  taskOf,
} from '../types/index.ts';

import { verifyStandardWebhook } from './signature.ts';

export interface EventVerifierDependencies {
  links: Pick<LinkRepository, 'byPath'>;
  /** Called per delivery: the adapter is registered before the integrations exist. */
  access: () => Pick<ConnectionAccess, 'find'>;
}

/** The type and the project of an event of a registry; null when the body is not such an object. */
function readEvent(parsed: unknown): { type: string; data: unknown; path: string } | null {
  const object = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const body = object(parsed);
  const data = object(body?.data);
  const path = object(data?.node)?.path;
  const type = body?.type;
  if (typeof type !== 'string' || type === '' || type.length > 128) return null;
  if (typeof path !== 'string' || path === '' || path.length > REGISTRY_PATH_LIMIT) return null;
  return { type, data, path };
}

/**
 * Standard Webhooks of a registry: the signature is checked on the raw bytes with the
 * `webhook_secret` of the connection, then the rules of the connection and the link of the project
 * decide what the event asks for. Everything that fails before the signature passes is
 * `unauthenticated`: the caller learns nothing about the cause.
 */
export function registryVerifier(dependencies: EventVerifierDependencies): InboundVerifierPort {
  return {
    async verify(context: VerifyContext) {
      const id = context.headers['webhook-id'] ?? '';
      let secret: string;
      try {
        secret = await context.secrets.read(WEBHOOK_SECRET_SLOT);
      } catch (error) {
        // An unset secret is a failed authentication; an unreachable storage is not.
        if (isAppError(error) && error.code === 'integrations.missing_secret') return null;
        throw error;
      }
      const signed = verifyStandardWebhook({
        secret,
        id,
        timestamp: context.headers['webhook-timestamp'] ?? '',
        signatures: context.headers['webhook-signature'] ?? '',
        body: context.body,
        now: context.receivedAt,
      });
      if (!signed) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(context.body).toString('utf8'));
      } catch {
        return context.ignore(id, 'malformed');
      }
      const event = readEvent(parsed);
      if (event === null) return context.ignore(id, 'malformed');
      const { type, path } = event;
      const meta = { type, path };
      const connection = dependencies.access().find(context.connectionId);
      const linked = dependencies.links.byPath(connection.id, path);
      if (linked.length === 0) return context.ignore(id, 'no_link', meta);
      const [link] = linked;
      if (linked.length > 1 || link === undefined)
        return context.ignore(id, 'ambiguous_link', meta);
      const rule = ruleOf(type, connection.params);
      if ('ignore' in rule) return context.ignore(id, rule.ignore, meta);
      const { title, task } = taskOf(event, registryBase(connection.params.url), path);
      return context.accept({
        externalEventId: id,
        project: link.project,
        meta,
        operation: {
          type: 'queue_task',
          pipeline: rule.pipeline,
          task,
          title,
          skipDuplicate: true,
        },
      });
    },
  };
}
