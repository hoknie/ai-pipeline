import { BRIDGE_CODES, RegistryFailure } from '../../../../feature/service-registry/types/index.ts';
import type { HandlerTable } from '../types.ts';

/** The JSON-RPC error the agent gets: a static code, never a text of the registry. */
function failure(id: unknown, code: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code: -32000, message: code, data: { code } } };
}

/**
 * Carries a JSON-RPC message of the bridge of an attempt to the registry behind the server. The
 * token of a running attempt is the only authority; every refusal comes back as a JSON-RPC error
 * with a static code, before the registry is asked and before a secret is read.
 */
export const remoteHandlers = {
  mcp_remote_forward: async (params, { services }) => {
    const id = params.message.id;
    const isRequest = id !== undefined && id !== null;
    const answer = (code: string) => ({ message: isRequest ? failure(id, code) : null });
    const found = services.runs.reads.remoteServer(params.token, params.server);
    if (!found.ok) return answer(found.code);
    try {
      const message = await services.serviceRegistry.forwarder.forward({
        session: params.token,
        server: params.server,
        project: found.project,
        connection: found.connection,
        message: params.message,
      });
      return { message };
    } catch (error) {
      const code = error instanceof RegistryFailure ? error.code : 'unreachable';
      return answer(BRIDGE_CODES.includes(code) ? code : 'unreachable');
    }
  },
} satisfies Partial<HandlerTable>;
