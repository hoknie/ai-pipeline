import type { InboundVerifierPort } from '../../integrations/services/index.ts';
import type { CheckResult, RegistryCheckRequest, RegistryTransportPort } from '../ports/index.ts';
import {
  RegistryFailure,
  registryBase,
  serviceRegistryDescriptor,
  type McpEndpoint,
} from '../types/index.ts';

export const PROTOCOL_VERSION = '2025-06-18';

export interface AdapterDependencies {
  transport: RegistryTransportPort;
  /** The proxy for a request to `url`: the settings and the environment of the daemon. */
  proxyFor: (url: string) => string | null;
}

function hasError(message: Record<string, unknown> | null): boolean {
  return message === null || 'error' in message;
}

/** `initialize` and `tools/list` over one session; the result is a code or a count of tools. */
async function checkRegistry(
  request: RegistryCheckRequest,
  { transport, proxyFor }: AdapterDependencies,
): Promise<CheckResult> {
  const base = registryBase(request.params.url);
  if (base === null) return { ok: false, code: 'unreachable' };
  let token: string;
  try {
    token = await request.secrets.read('token');
  } catch {
    return { ok: false, code: 'secret_unavailable' };
  }
  const endpoint: McpEndpoint = { base, token, proxyFor, signal: request.signal };
  try {
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
    if (hasError(opened.message)) return { ok: false, code: 'protocol' };
    endpoint.sessionId = opened.sessionId;
    try {
      await transport.post(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' });
      const listed = await transport.post(endpoint, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });
      const result = listed.message?.result;
      const tools = (result as { tools?: unknown } | undefined)?.tools;
      if (hasError(listed.message) || !Array.isArray(tools)) return { ok: false, code: 'protocol' };
      return { ok: true, count: tools.length };
    } finally {
      await transport.close(endpoint);
    }
  } catch (error) {
    return { ok: false, code: error instanceof RegistryFailure ? error.code : 'unreachable' };
  }
}

/** The adapter of the integrations for the kind: the descriptor and the connection check. */
export function serviceRegistryAdapter(
  dependencies: AdapterDependencies,
  verifier?: InboundVerifierPort,
) {
  return {
    descriptor: serviceRegistryDescriptor,
    ...(verifier === undefined ? {} : { verifier }),
    check: {
      check: (request: RegistryCheckRequest): Promise<CheckResult> =>
        checkRegistry(request, dependencies),
    },
  };
}
