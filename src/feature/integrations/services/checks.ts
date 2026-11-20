import type { ConnectionRepository } from '../repositories/index.ts';
import { refusal, type ConnectionCheck, type ConnectionView } from '../types/index.ts';

import type { ConnectionAccess } from './access.ts';
import type { AdapterCatalog } from './catalog.ts';
import type { ConnectionService } from './connections.ts';
import type { SecretService } from './secrets.ts';

export interface ChecksDependencies {
  connections: ConnectionRepository;
  catalog: AdapterCatalog;
  access: ConnectionAccess;
  secretService: SecretService;
  /** The safe view of a connection after its check. */
  views: Pick<ConnectionService, 'view'>;
  now: () => number;
  /** The longest a check runs; default 15 s. */
  timeoutMs?: number;
}

/** The check of a connection: the adapter of its kind reaches the other system, the outcome is kept. */
export class ConnectionChecks {
  private readonly dependencies: ChecksDependencies;

  constructor(dependencies: ChecksDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Asks the adapter of the kind to reach the other system and records the safe outcome. Only an
   * enabled connection with every required secret is checked; no other call is made before that.
   */
  async check(id: string): Promise<ConnectionView> {
    const { access, catalog, secretService, connections, now } = this.dependencies;
    const connection = access.find(id);
    if (!catalog.has(connection.kind)) throw refusal('unknown_kind');
    const adapter = catalog.adapter(connection.kind);
    if (adapter.check === undefined) throw refusal('no_check');
    if (!connection.enabled || connection.state !== 'ready' || secretService.pending(connection)) {
      throw refusal('disabled');
    }
    if (!access.complete(connection)) throw refusal('missing_secret');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.dependencies.timeoutMs ?? 15_000);
    let outcome: ConnectionCheck;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('timeout')), {
          once: true,
        });
      });
      const result = await Promise.race([
        adapter.check.check({
          params: connection.params,
          secrets: { read: (slot) => secretService.read(connection.id, slot) },
          signal: controller.signal,
        }),
        aborted,
      ]);
      const safe = /^[a-z_]{1,32}$/;
      outcome = {
        at: now(),
        ok: result.ok === true,
        code: result.ok ? null : safe.test(result.code ?? '') ? (result.code ?? null) : 'failed',
        count: Number.isSafeInteger(result.count) ? (result.count ?? null) : null,
      };
    } catch {
      // A failure of the other system or of the secret store is a failure here, with a static code.
      outcome = {
        at: now(),
        ok: false,
        code: controller.signal.aborted ? 'timeout' : 'failed',
        count: null,
      };
    } finally {
      clearTimeout(timer);
    }
    connections.setLastCheck(id, outcome);
    return this.dependencies.views.view(access.find(id));
  }
}
