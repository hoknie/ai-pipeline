import { createInterface } from 'node:readline';
export interface RemoteBridgeOptions {
  /** The token of the attempt: the only thing the bridge knows about who it speaks for. */
  token: string;
  /** The name of the server of the specialist the bridge stands for. */
  server: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** One request to the daemon; the IPC client of the socket of the attempt. */
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

/** A JSON-RPC error with a static code: the agent learns what kind of failure it was, nothing more. */
function failure(id: unknown, code: string, number = -32000): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: number, message: code } });
}

/**
 * Relays the JSON-RPC lines of an agent (newline-delimited, as MCP over stdio) to the daemon and
 * writes what comes back. It does not interpret MCP: authority, the address of the registry and the
 * secret stay in the daemon. Ends when the input ends and every answer is written.
 */
export async function runRemoteBridge(options: RemoteBridgeOptions): Promise<void> {
  const { token, server, input, output, send } = options;
  const pending = new Set<Promise<void>>();
  const write = (line: string): void => void output.write(`${line}\n`);
  const relay = async (line: string): Promise<void> => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write(failure(null, 'parse_error', -32700));
      return;
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      write(failure(null, 'invalid_request', -32600));
      return;
    }
    const id = (message as { id?: unknown }).id;
    try {
      const answer = (await send('mcp_remote_forward', { token, server, message })) as {
        message?: Record<string, unknown> | null;
      };
      if (answer.message !== null && answer.message !== undefined) {
        write(JSON.stringify(answer.message));
      }
    } catch {
      // A notification has no one to tell; a request gets the static code.
      if (id !== undefined && id !== null) write(failure(id, 'daemon_unavailable'));
    }
  };
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    const work = relay(line).finally(() => pending.delete(work));
    pending.add(work);
  }
  await Promise.all(pending);
}
