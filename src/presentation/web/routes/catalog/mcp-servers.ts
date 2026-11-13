import { z } from 'zod';
import {
  mcpServerNameSchema,
  mcpServerValueSchema,
  type ConfigEditResult,
} from '../../../ipc/contract/index.ts';
import { editReply, parseBody, levelParam } from '../../http.ts';
import { segment, type Route, type RouteKit } from '../types.ts';

const mcpServerBody = z.object({
  value: mcpServerValueSchema,
  revision: z.string().min(1).nullable(),
  level: levelParam.optional(),
});

const mcpServerDeleteQuery = z.object({
  revision: z.string().min(1),
  level: levelParam.optional(),
});

/** Writes and removes one server of the MCP catalog of a level. */
export function mcpServerRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/config/mcp-servers/${segment}$`),
      handle: async ([name], body, repository) => {
        const { value, revision, level } = parseBody(mcpServerBody, body);
        return editReply(
          (await call('config_mcp_server', {
            repository,
            name: parseBody(mcpServerNameSchema, name),
            value,
            revision,
            level: level ?? 'global',
          })) as ConfigEditResult,
        );
      },
    },
    {
      method: 'DELETE',
      pattern: new RegExp(`^/api/config/mcp-servers/${segment}$`),
      handle: async ([name], _body, repository, query) => {
        const { revision, level } = parseBody(mcpServerDeleteQuery, {
          revision: query.get('revision') ?? undefined,
          level: query.get('level') ?? undefined,
        });
        return editReply(
          (await call('config_mcp_server', {
            repository,
            name: parseBody(mcpServerNameSchema, name),
            value: null,
            revision,
            level: level ?? 'global',
          })) as ConfigEditResult,
        );
      },
    },
  ];
}
