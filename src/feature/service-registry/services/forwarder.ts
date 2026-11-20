import type { RegistryTransportPort } from '../ports/index.ts';
import {
  RegistryFailure,
  SERVICE_REGISTRY_KIND,
  registryBase,
  type McpEndpoint,
} from '../types/index.ts';

import type { IntegrationsServices } from '../../integrations/services/index.ts';

export interface ForwarderDependencies {
  transport: RegistryTransportPort;
  /** The connections and their secrets; resolved at the moment of a call. */
  integrations: () => Pick<IntegrationsServices, 'access' | 'secrets'>;
  proxyFor: (url: string) => string | null;
}

/** What the bridge of an attempt asks for: one JSON-RPC message of the agent. */
export interface ForwardRequest {
  /** The token of the attempt: the key of the registry session kept for it. */
  session: string;
  /** The root of the project the attempt works on. */
  project: string;
  /** The name of the server of the specialist: one registry session per (attempt, server). */
  server: string;
  /** The name of the connection the server of the specialist goes through. */
  connection: string;
  message: unknown;
}

interface Session {
  connectionId: string;
  sessionId: string | null;
}

/**
 * Carries the messages of the bridges to the registries: reads the secret for the time of one
 * request, keeps the `Mcp-Session-Id` of the registry per attempt and closes it at the end of the
 * attempt. A refusal or a failure is a static code, never a text of the registry.
 */
export class Forwarder {
  private readonly dependencies: ForwarderDependencies;
  private readonly sessions = new Map<string, Session>();
  private readonly keyOf = (token: string, server: string): string => `${token}\u0000${server}`;

  constructor(dependencies: ForwarderDependencies) {
    this.dependencies = dependencies;
  }

  /** Whether a connection of this name serves the project now, without reading a secret. */
  resolve(project: string, name: string): 'ok' | 'unavailable' | 'disabled' {
    const { access } = this.dependencies.integrations();
    const connection = access.named(SERVICE_REGISTRY_KIND, name, project);
    if (connection === undefined) return 'unavailable';
    try {
      access.authorize(connection.id, project);
    } catch {
      return 'disabled';
    }
    return access.complete(connection) ? 'ok' : 'disabled';
  }

  /** The answer of the registry (null for a notification); a failure throws a `RegistryFailure`. */
  async forward(request: ForwardRequest): Promise<Record<string, unknown> | null> {
    const { access, secrets } = this.dependencies.integrations();
    const { message } = request;
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      throw new RegistryFailure('protocol');
    }
    const connection = access.named(SERVICE_REGISTRY_KIND, request.connection, request.project);
    if (connection === undefined) throw new RegistryFailure('connection_disabled');
    try {
      access.authorize(connection.id, request.project);
    } catch {
      throw new RegistryFailure('connection_disabled');
    }
    const base = registryBase(connection.params.url);
    if (base === null || !access.complete(connection)) {
      throw new RegistryFailure(base === null ? 'unreachable' : 'connection_disabled');
    }
    let token: string;
    try {
      token = await secrets.read(connection.id, 'token');
    } catch {
      throw new RegistryFailure('secret_unavailable');
    }
    const key = this.keyOf(request.session, request.server);
    let session = this.sessions.get(key);
    if (session === undefined || session.connectionId !== connection.id) {
      session = { connectionId: connection.id, sessionId: null };
      this.sessions.set(key, session);
    }
    const endpoint: McpEndpoint = {
      base,
      token,
      sessionId: session.sessionId,
      proxyFor: this.dependencies.proxyFor,
    };
    const reply = await this.dependencies.transport.post(
      endpoint,
      message as Record<string, unknown>,
    );
    if (reply.sessionId !== null) session.sessionId = reply.sessionId;
    return reply.message;
  }

  /** The attempt ended: every session of it in the registry is closed, best effort. */
  async close(session: string): Promise<void> {
    const prefix = `${session}\u0000`;
    const kept: Session[] = [];
    for (const [key, value] of [...this.sessions]) {
      if (!key.startsWith(prefix)) continue;
      this.sessions.delete(key);
      kept.push(value);
    }
    await Promise.all(kept.map((one) => this.closeOne(one)));
  }

  private async closeOne(kept: Session): Promise<void> {
    if (kept.sessionId == null) return;
    const { access, secrets } = this.dependencies.integrations();
    try {
      const connection = access.find(kept.connectionId);
      const base = registryBase(connection.params.url);
      if (base === null) return;
      const token = await secrets.read(connection.id, 'token');
      await this.dependencies.transport.close({
        base,
        token,
        sessionId: kept.sessionId,
        proxyFor: this.dependencies.proxyFor,
        timeoutMs: 5000,
      });
    } catch {
      // the registry drops an idle session on its own
    }
  }
}
