import { isAppError } from '../../../platform/errors/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { IntegrationOperationsPort, VerifiedToken, VerifyContext } from '../ports/index.ts';
import type { DeliveryRepository } from '../repositories/index.ts';
import {
  DEFAULT_INBOUND_LIMITS,
  EVENT_ID_PATTERN,
  isOperation,
  refusal,
  type AcceptedEvent,
  type Connection,
  type DispatchOutcome,
  type InboundLimits,
} from '../types/index.ts';

import type { AdapterCatalog } from './catalog.ts';
import type { ConnectionAccess } from './access.ts';
import type { SecretService } from './secrets.ts';

export interface InboundDependencies {
  catalog: AdapterCatalog;
  access: ConnectionAccess;
  secrets: SecretService;
  deliveries: DeliveryRepository;
  registry: RegistryService;
  operations: IntegrationOperationsPort;
  now: () => number;
  limits?: Partial<InboundLimits>;
}

/** What the transport of a concrete adapter hands over: raw bytes and where they came from. */
export interface InboundRequest {
  /** The built-in kind whose registered verifier checks the bytes. */
  verifier: string;
  /** The connection the transport addressed; it stays a claim until the verifier accepts the bytes. */
  connectionId: string;
  body: Uint8Array;
  headers: Readonly<Record<string, string>>;
}

interface Grant {
  connectionId: string;
  event: AcceptedEvent | null;
  used: boolean;
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(refusal('timeout')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The only way an external event reaches the domain: raw bytes in, a trusted built-in verifier
 * checks them, and only the proof this service itself issued to that verifier opens the way to the
 * claim and the operation. Nobody outside can hand over an "already authenticated" object.
 */
export class InboundService {
  private readonly dependencies: InboundDependencies;
  private readonly limits: InboundLimits;
  /** The proofs issued to verifiers: a forged structure is not in here. */
  private readonly grants = new WeakMap<object, Grant>();

  constructor(dependencies: InboundDependencies) {
    this.dependencies = dependencies;
    this.limits = { ...DEFAULT_INBOUND_LIMITS, ...dependencies.limits };
  }

  async receive(request: InboundRequest): Promise<DispatchOutcome> {
    if (request.body.byteLength > this.limits.maxBodyBytes) throw refusal('too_large');
    const event = await this.verified(request);
    const connection = this.recheck(request.connectionId);
    const adapter = this.dependencies.catalog.adapter(connection.kind);
    if (!adapter.descriptor.operations.includes(event.operation.type)) {
      throw refusal('operation_denied');
    }
    const project = await this.projectOf(connection, event);
    return this.dispatch(connection, project, event);
  }

  /** Runs the trusted verifier on the raw bytes and returns what it accepted. */
  private async verified(request: InboundRequest): Promise<AcceptedEvent> {
    const { catalog, secrets, now } = this.dependencies;
    const verifier = catalog.has(request.verifier)
      ? catalog.adapter(request.verifier).verifier
      : undefined;
    if (verifier === undefined) throw refusal('unauthenticated');
    const connection = this.recheck(request.connectionId);
    if (connection.kind !== request.verifier) throw refusal('unauthenticated');
    const grant: Grant = { connectionId: connection.id, event: null, used: false };
    const context: VerifyContext = {
      connectionId: connection.id,
      body: request.body,
      headers: request.headers,
      receivedAt: now(),
      secrets: { read: (slot) => secrets.read(connection.id, slot) },
      accept: (event) => {
        if (!EVENT_ID_PATTERN.test(event.externalEventId) || !isOperation(event.operation)) {
          throw refusal('unauthenticated');
        }
        const token: VerifiedToken = Object.freeze({ brand: 'verified' as const });
        grant.event = event;
        this.grants.set(token, grant);
        return token;
      },
    };
    let token: VerifiedToken | null;
    try {
      token = await withDeadline(verifier.verify(context), this.limits.deadlineMs);
    } catch (error) {
      if (isAppError(error) && error.code === 'integrations.timeout') throw error;
      throw refusal('unauthenticated');
    }
    const issued = token === null ? undefined : this.grants.get(token);
    if (issued !== grant || grant.used || grant.event === null) throw refusal('unauthenticated');
    grant.used = true;
    return grant.event;
  }

  /** The state of the connection as it is now: enabled, ready, nothing pending, secrets in place. */
  private recheck(connectionId: string): Connection {
    const { access } = this.dependencies;
    let connection: Connection;
    try {
      connection = access.find(connectionId);
    } catch {
      throw refusal('unauthenticated');
    }
    if (!access.complete(connection)) throw refusal('disabled');
    return access.authorize(connectionId, connection.projectPath ?? '');
  }

  /** The project an event acts on: a project connection acts on its own, a global one names it. */
  private async projectOf(connection: Connection, event: AcceptedEvent): Promise<string> {
    const { registry } = this.dependencies;
    let named: string | null = null;
    if (event.project !== undefined) {
      try {
        named = await registry.resolve(event.project);
      } catch {
        throw refusal('unknown_project');
      }
    }
    if (connection.scope === 'project') {
      if (named !== null && named !== connection.projectPath) throw refusal('scope_denied');
      return connection.projectPath!;
    }
    if (named === null) throw refusal('unknown_project');
    this.dependencies.access.authorize(connection.id, named);
    registry.requireEnabled(named);
    return named;
  }

  /** Claims the event id and performs the operation; a repeat never performs it again. */
  private async dispatch(
    connection: Connection,
    project: string,
    event: AcceptedEvent,
  ): Promise<DispatchOutcome> {
    const { deliveries, operations, now } = this.dependencies;
    const id = event.externalEventId;
    if (!deliveries.claim(connection.id, id, now())) {
      const known = deliveries.find(connection.id, id);
      if (known?.state === 'applied') {
        return { status: 'duplicate', connectionId: connection.id, result: known.result ?? {} };
      }
      return { status: 'unknown_outcome', connectionId: connection.id };
    }
    try {
      const result = await withDeadline(
        operations.perform(project, event.operation),
        this.limits.deadlineMs,
      );
      deliveries.markApplied(connection.id, id, result, now());
      return { status: 'applied', connectionId: connection.id, result };
    } catch (error) {
      // A refusal of the domain changed nothing and gives the id back; anything else may have
      // changed something, so the claim stays and the outcome is unknown.
      if (isAppError(error) && error.code !== 'integrations.timeout') {
        deliveries.release(connection.id, id);
        throw refusal('operation_denied');
      }
      return { status: 'unknown_outcome', connectionId: connection.id };
    }
  }
}
