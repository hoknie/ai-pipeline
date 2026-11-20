import type { IntegrationAdapterPort } from '../../feature/integrations/ports/index.ts';
import type { IntegrationsServices } from '../../feature/integrations/services/index.ts';
import { probeProxy } from '../../feature/network/types/index.ts';
import {
  telegramAdapter,
  telegramChannelFactory,
} from '../../feature/notifications/clients/index.ts';
import type {
  ChannelFactoryPort,
  NotificationsPublishPort,
} from '../../feature/notifications/ports/index.ts';
import { createNotificationsServices } from '../../feature/notifications/services/index.ts';
import type { RegistryService } from '../../feature/repos/services/index.ts';
import type { RunsServices } from '../../feature/runs/services/index.ts';
import type { ConfigService } from '../../feature/swarm-config/services/index.ts';
import type { Database } from '../../platform/sqlite/index.ts';

/** The adapters of the integrations this build brings: the chat kinds of the notifications. */
export function builtInAdapters(): IntegrationAdapterPort[] {
  return [telegramAdapter()];
}

/** What the composition root has at hand when it builds the notifications. */
interface NotificationsContext {
  options: {
    notifications?: { kinds?: readonly ChannelFactoryPort[]; restartMs?: number } | undefined;
    log?: ((message: string) => void) | undefined;
  };
  environment: NodeJS.ProcessEnv;
  database: Database;
  now: () => number;
  ports: { notifications: { port: NotificationsPublishPort } };
}

interface NotificationsLower {
  registry: RegistryService;
  config: ConfigService;
  integrations: IntegrationsServices;
  network: { proxy(): string | null };
}

/** The notifications: the channel kinds of this build over the services below them. */
export function createNotifications(
  context: NotificationsContext,
  lower: NotificationsLower,
  runs: RunsServices,
) {
  const { environment, options } = context;
  // The address of the Bot API is read once here; the tests point it at a fake one.
  const base = environment.AIP_TELEGRAM_API ?? 'https://api.telegram.org';
  return createNotificationsServices({
    database: context.database,
    now: context.now,
    runs,
    registry: lower.registry,
    config: lower.config,
    integrations: lower.integrations,
    kinds: options.notifications?.kinds ?? [
      telegramChannelFactory({
        base,
        proxy: () => probeProxy(base, lower.network.proxy(), environment),
      }),
    ],
    ...(options.notifications?.restartMs === undefined
      ? {}
      : { restartMs: options.notifications.restartMs }),
    publish: context.ports.notifications.port,
    log: options.log ?? ((message) => console.error(`[aip] ${message}`)),
  });
}
