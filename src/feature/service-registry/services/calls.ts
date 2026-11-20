import type { Connection } from '../../integrations/types/index.ts';
import type { RegistryTransportPort } from '../ports/index.ts';
import { RegistryFailure, registryBase, type McpEndpoint } from '../types/index.ts';

import { PROTOCOL_VERSION } from './adapter.ts';

/** The registry answered the call with an error of the tool itself (the project does not exist, say). */
export class ToolRefused extends Error {
  constructor() {
    super('tool refused');
    this.name = 'ToolRefused';
  }
}

export interface CallDependencies {
  transport: RegistryTransportPort;
  proxyFor: (url: string) => string | null;
}

/** The structured answer of a tool: `structuredContent`, or the JSON of its first text part. */
function resultOf(message: Record<string, unknown> | null): unknown {
  if (message === null || 'error' in message) throw new RegistryFailure('protocol');
  const result = message.result;
  if (typeof result !== 'object' || result === null) throw new RegistryFailure('protocol');
  const { isError, structuredContent, content } = result as {
    isError?: unknown;
    structuredContent?: unknown;
    content?: unknown;
  };
  if (isError === true) throw new ToolRefused();
  if (structuredContent !== undefined) return structuredContent;
  if (Array.isArray(content)) {
    for (const part of content as { type?: unknown; text?: unknown }[]) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        try {
          return JSON.parse(part.text) as unknown;
        } catch {
          throw new RegistryFailure('protocol');
        }
      }
    }
  }
  throw new RegistryFailure('protocol');
}

/**
 * One call of a tool of a registry over a session of its own, opened for it and closed after it.
 * A failure is a `RegistryFailure` (static code) or a `ToolRefused`.
 */
export class RegistryCalls {
  private readonly dependencies: CallDependencies;

  constructor(dependencies: CallDependencies) {
    this.dependencies = dependencies;
  }

  async call(
    connection: Connection,
    token: string,
    tool: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const base = registryBase(connection.params.url);
    if (base === null) throw new RegistryFailure('unreachable');
    const { transport, proxyFor } = this.dependencies;
    const endpoint: McpEndpoint = {
      base,
      token,
      proxyFor,
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    };
    const opened = await transport.post(endpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'aip', version: '1' },
      },
    });
    if (opened.message === null || 'error' in opened.message) {
      throw new RegistryFailure('protocol');
    }
    endpoint.sessionId = opened.sessionId;
    try {
      await transport.post(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' });
      const reply = await transport.post(endpoint, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      });
      return resultOf(reply.message);
    } finally {
      await transport.close(endpoint);
    }
  }
}
