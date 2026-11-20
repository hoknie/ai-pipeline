import {
  failureCode,
  refusal,
  type ConnectionView as RegistryView,
} from '../../../../feature/integrations/types/index.ts';
import {
  SERVICE_REGISTRY_KIND,
  registryBase,
  registryProjectUrl,
  type ProjectLink,
} from '../../../../feature/service-registry/types/index.ts';
import { isAppError } from '../../../../platform/errors/index.ts';
import { displayUrl, WEBHOOK_KIND } from '../../../../feature/notifications/types/index.ts';
import type { ConnectionView, ProjectLinkView } from '../../contract/index.ts';
import { channelView } from '../../views/index.ts';
import type { DaemonServices } from '../../services.ts';

import type { HandlerTable } from '../types.ts';

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

/** The connection of a project by id, or by name among the registries the project may use. */
function registryConnection(services: DaemonServices, project: string, reference: string) {
  const { access } = services.integrations;
  try {
    const found = access.find(reference);
    if (found.kind === SERVICE_REGISTRY_KIND) return found;
  } catch {
    // not an id: a name is tried next
  }
  const named = access.named(SERVICE_REGISTRY_KIND, reference, project);
  if (named === undefined) throw refusal('not_found');
  return named;
}

/** A link with the connection it belongs to and the address of the project in the registry. */
function linkView(services: DaemonServices, link: ProjectLink): ProjectLinkView {
  const connection = services.integrations.access.find(link.connectionId);
  const base = registryBase(connection.params.url);
  return {
    project: link.project,
    connection: connection.id,
    connectionName: connection.name,
    registryPath: link.registryPath,
    source: link.source,
    status: link.status,
    candidates: link.candidates,
    matchedAt: link.matchedAt,
    url:
      base === null || link.registryPath === null
        ? null
        : registryProjectUrl(base, link.registryPath),
  };
}

/** The links of the service registries: the errors are static texts, never a text of a registry. */
async function linking<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw isAppError(error) ? error : refusal('internal');
  }
}

/** The connection with the state of its channel listener, when it has one. */
function withChannel(services: DaemonServices, shown: RegistryView): ConnectionView {
  // The address of a webhook may hold a token in its query: it never leaves whole.
  const view =
    shown.kind === WEBHOOK_KIND && shown.params.url !== undefined
      ? { ...shown, params: { ...shown.params, url: displayUrl(shown.params.url) } }
      : shown;
  const status = services.notifications.channels.statusOf(view.id);
  return { ...view, channel: status === null ? null : channelView(status, view.id) };
}

/** Connections to external systems and their secrets: managed from the local CLI only. */
export const integrationHandlers = {
  integration_types: (_params, { services }) =>
    guarded(() => services.integrations.connections.types()),
  integration_list: (params, { services }) =>
    guarded(async () =>
      (await services.integrations.connections.list(params.repository)).map((view) =>
        withChannel(services, view),
      ),
    ),
  integration_add: (params, { services }) =>
    guarded(async () => withChannel(services, await services.integrations.connections.add(params))),
  integration_edit: (params, { services }) =>
    guarded(async () =>
      withChannel(
        services,
        await services.integrations.connections.edit(params.id, {
          set: params.set ?? {},
          unset: params.unset ?? [],
        }),
      ),
    ),
  integration_remove: (params, { services }) =>
    guarded(async () => {
      await services.integrations.connections.remove(params.id);
      return { removed: params.id };
    }),
  integration_enable: (params, { services }) =>
    guarded(async () =>
      withChannel(services, await services.integrations.connections.enable(params.id)),
    ),
  integration_disable: (params, { services }) =>
    guarded(() => withChannel(services, services.integrations.connections.disable(params.id))),
  integration_check: (params, { services }) =>
    guarded(async () => withChannel(services, await services.integrations.checks.check(params.id))),
  integration_secret_set: (params, { services }) =>
    guarded(async () =>
      withChannel(
        services,
        await services.integrations.connections.setSecret(params.id, params.slot, params.value),
      ),
    ),
  integration_link: (params, { services }) =>
    linking(async () => {
      const project = await services.registry.resolve(params.repository);
      const connection = registryConnection(services, project, params.id);
      const { links } = services.serviceRegistry;
      const link =
        params.path !== undefined
          ? await links.manualLink(project, connection.id, params.path)
          : params.clear === true
            ? links.clear(project, connection.id)
            : await links.autoLink(project, connection.id, 'command');
      return linkView(services, link);
    }),
  integration_links: (params, { services }) =>
    linking(async () => {
      const project =
        params.repository === undefined
          ? undefined
          : await services.registry.resolve(params.repository);
      return services.serviceRegistry.links.list(project).flatMap((link) => {
        try {
          return [linkView(services, link)];
        } catch {
          return [];
        }
      });
    }),
  integration_secret_remove: (params, { services }) =>
    guarded(async () =>
      withChannel(
        services,
        await services.integrations.connections.removeSecret(params.id, params.slot),
      ),
    ),
} satisfies Partial<HandlerTable>;
