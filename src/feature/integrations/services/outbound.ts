import { refusal, type OperationResult } from '../types/index.ts';

import type { AdapterCatalog } from './catalog.ts';
import type { ConnectionAccess } from './access.ts';
import type { SecretService } from './secrets.ts';

export interface OutboundDependencies {
  catalog: AdapterCatalog;
  access: ConnectionAccess;
  secrets: SecretService;
  /** The longest an outbound call may take; adapters get an abort signal. */
  timeoutMs: number;
}

export interface OutboundCall {
  connectionId: string;
  project: string;
  action: string;
  payload?: Readonly<Record<string, string>>;
}

/** What a caller learns about an outbound call: a verdict and a code, never a secret. */
export type OutboundOutcome =
  { ok: true; result: OperationResult } | { ok: false; code: 'timeout' | 'failed' };

/**
 * Outbound operations of an adapter: only through an enabled connection that serves the project,
 * with a time limit. The secrets of that connection are readable for the length of the call.
 */
export class OutboundService {
  private readonly dependencies: OutboundDependencies;

  constructor(dependencies: OutboundDependencies) {
    this.dependencies = dependencies;
  }

  async perform(call: OutboundCall): Promise<OutboundOutcome> {
    const { catalog, access, secrets, timeoutMs } = this.dependencies;
    // Authority comes first: the secret is not read for a connection that may not do this.
    const connection = access.authorize(call.connectionId, call.project);
    const adapter = catalog.adapter(connection.kind);
    if (adapter.outbound === undefined || !adapter.descriptor.directions.includes('outbound')) {
      throw refusal('operation_denied');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const work = adapter.outbound.perform({
        connectionId: connection.id,
        project: call.project,
        action: call.action,
        payload: call.payload ?? {},
        secrets: { read: (slot) => secrets.read(connection.id, slot) },
        signal: controller.signal,
      });
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('timeout')), {
          once: true,
        });
      });
      return { ok: true, result: await Promise.race([work, aborted]) };
    } catch {
      // A failure of the other system is a failure here: no success is written for it.
      return { ok: false, code: controller.signal.aborted ? 'timeout' : 'failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}
