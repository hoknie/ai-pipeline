import { DAY, parseTtl } from '../feature/identity/types/index.ts';
import type { Database } from '../platform/sqlite/index.ts';
import type { DaemonServices } from '../presentation/ipc/services.ts';

/** The start and the stop of the daemon, in the order the services need. */
export interface Lifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createLifecycle(
  services: DaemonServices,
  database: Database,
  log: (message: string) => void,
): Lifecycle {
  const {
    network,
    runs,
    queue,
    tags,
    registry,
    observers,
    delivery,
    artifacts,
    attachments,
    processes,
    stats,
    integrations,
    notifications,
  } = services;
  const auditPruner = createAuditPruner(services, log);
  const skillCachePruner = createSkillCachePruner(services, log);
  return {
    async start() {
      network.start();
      // Operations on secrets a stop cut short are finished before anything can use a connection.
      await integrations.secrets.recover();
      await delivery.patches.sweep();
      await artifacts.sweep();
      await runs.engine.serial(async () => {
        const recovered = runs.states.recover();
        queue.store.load();
        // The mode of the settings may have changed while the daemon was stopped.
        queue.scope.sync();
        tags.load();
        registry.load();
        await attachments.sweep({
          items: new Set(queue.store.all().flatMap((one) => one.items.map((item) => item.id))),
          hasRun: (id) => runs.states.lookup(id) !== undefined,
        });
        observers.load();
        // The history moves into the usage journal once, before the first new record.
        await stats.ledger.backfill();
        // A delivery cut off by the restart starts again.
        for (const { state, effects } of recovered) await runs.effects.perform(state, effects);
        await runs.engine.schedule();
        await queue.advance.resume();
        // Incidents from before the start, in finished runs too.
        await observers.observe(true);
        runs.engine.armWake();
      });
      // Questions that waited while the daemon was off are sent; the bots start listening.
      await notifications.dispatcher.start();
      await notifications.channels.start();
      auditPruner.start();
      skillCachePruner.start();
      warnAboutUsersWithoutRole(services, log);
    },
    async stop() {
      auditPruner.stop();
      skillCachePruner.stop();
      await notifications.channels.stop();
      await notifications.dispatcher.stop();
      runs.engine.halt();
      network.stop();
      processes.stop();
      await runs.engine.drain();
      database.close();
    },
  };
}

/** How often the audit journal is cleared of old entries. */
export const AUDIT_PRUNE_MS = DAY;

/** The retention used when the setting cannot be read. */
const DEFAULT_RETENTION_MS = 365 * DAY;

export interface AuditPruner {
  /** Deletes the entries older than `server.audit_retention`; returns how many. */
  prune(): number;
  start(): void;
  stop(): void;
}

/** Clears the journal once at the start and then every day; the server mode only. */
export function createAuditPruner(
  services: Pick<DaemonServices, 'audit' | 'config' | 'now'>,
  log: (message: string) => void,
  intervalMs = AUDIT_PRUNE_MS,
): AuditPruner {
  let timer: NodeJS.Timeout | null = null;
  const prune = (): number => {
    const settings = services.config.serverSettings();
    if (typeof settings === 'string' || !settings.enabled) return 0;
    const retention = parseTtl(settings.auditRetention) ?? DEFAULT_RETENTION_MS;
    try {
      return services.audit.prune(services.now() - retention);
    } catch (error) {
      log(`audit: cannot clear the journal: ${error instanceof Error ? error.message : error}`);
      return 0;
    }
  };
  return {
    prune,
    start() {
      prune();
      timer = setInterval(prune, intervalMs);
      timer.unref();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

/** How often the cache of the skills of the registries is cleared. */
export const SKILL_CACHE_PRUNE_MS = DAY;

/** Removes the cached skill versions nobody used for 30 days: at the start and then every day. */
export function createSkillCachePruner(
  services: Pick<DaemonServices, 'serviceRegistry'>,
  log: (message: string) => void,
  intervalMs = SKILL_CACHE_PRUNE_MS,
): { prune(): number; start(): void; stop(): void } {
  let timer: NodeJS.Timeout | null = null;
  const prune = (): number => {
    try {
      return services.serviceRegistry.skills.cache.prune();
    } catch (error) {
      log(
        `service-registry: cannot clear the skill cache: ${error instanceof Error ? error.message : error}`,
      );
      return 0;
    }
  };
  return {
    prune,
    start() {
      prune();
      timer = setInterval(prune, intervalMs);
      timer.unref();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

/** In server mode, says which users will be refused everything: no role and no `server.default_role`. */
export function warnAboutUsersWithoutRole(
  services: Pick<DaemonServices, 'access' | 'config'>,
  log: (message: string) => void,
): void {
  const settings = services.config.serverSettings();
  if (typeof settings === 'string' || !settings.enabled) return;
  const users = services.access.usersWithoutRole();
  if (users.length === 0) return;
  log(
    `access: ${users.length} active user(s) have no \`role\` and server.default_role is not set, so they are refused every action: ${users
      .map((user) => user.email)
      .join(', ')}`,
  );
}
