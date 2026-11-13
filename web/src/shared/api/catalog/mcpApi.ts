import type { ConfigEditResult, McpServerValue, WriteLevel } from '../types.ts';
import { edit, enc, json, levelQuery } from '../http.ts';

/** The servers of the MCP catalog of a level. */
export interface McpServerApi {
  /** Writes one server; a variable with `null` keeps the value of the file. */
  writeMcpServer(
    name: string,
    value: McpServerValue,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  deleteMcpServer(name: string, revision: string, level?: WriteLevel): Promise<ConfigEditResult>;
}

export function mcpServerApi(at: (path: string) => string): McpServerApi {
  return {
    writeMcpServer: (name, value, revision, level) =>
      edit(
        at(`/api/config/mcp-servers/${enc(name)}`),
        json('PUT', { value, revision, ...(level ? { level } : {}) }),
      ),
    deleteMcpServer: (name, revision, level) =>
      edit(
        at(`/api/config/mcp-servers/${enc(name)}?revision=${enc(revision)}${levelQuery(level)}`),
        {
          method: 'DELETE',
        },
      ),
  };
}
