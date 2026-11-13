import { parseReferences, type McpServer } from '../../../swarm-config/types/index.ts';

export type ExpandedMcpServers =
  { ok: true; servers: Record<string, McpServer> } | { ok: false; error: string };

type Variables = Readonly<Record<string, string | undefined>>;

function expandValue(value: string, variables: Variables): string | { missing: string } {
  const parsed = parseReferences(value);
  // The configuration is validated when it loads; a snapshot of another build is kept as text.
  if ('error' in parsed) return value;
  let result = '';
  for (const token of parsed.tokens) {
    if ('text' in token) {
      result += token.text;
      continue;
    }
    const variable = variables[token.variable];
    if (variable === undefined) return { missing: token.variable };
    result += variable;
  }
  return result;
}

/**
 * Replaces `${NAME}` in the `args` and `env` of the servers by the values of `variables`; `$${`
 * stays the literal text `${`. A variable that is not set gives an error naming the server and
 * the variable. The servers given are not changed.
 */
export function expandMcpServers(
  servers: Readonly<Record<string, McpServer>>,
  variables: Variables,
): ExpandedMcpServers {
  const result: Record<string, McpServer> = {};
  for (const [name, server] of Object.entries(servers)) {
    const args: string[] = [];
    const env: Record<string, string> = {};
    const values = [
      ...server.args.map((value, index) => ({
        value,
        set: (text: string) => (args[index] = text),
      })),
      ...Object.entries(server.env).map(([key, value]) => ({
        value,
        set: (text: string) => (env[key] = text),
      })),
    ];
    for (const { value, set } of values) {
      const expanded = expandValue(value, variables);
      if (typeof expanded !== 'string') {
        return {
          ok: false,
          error: `MCP server ${name}: environment variable ${expanded.missing} is not set`,
        };
      }
      set(expanded);
    }
    result[name] = { command: server.command, args, env };
  }
  return { ok: true, servers: result };
}
