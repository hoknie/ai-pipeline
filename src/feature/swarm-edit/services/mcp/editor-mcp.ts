import { checkMcpCatalog } from '../../../swarm-config/services/index.ts';
import {
  type CatalogMcpServer,
  type ConfigPaths,
  isMapping,
  type Level,
} from '../../../swarm-config/types/index.ts';
import { settingsFile } from '../../repositories/documents.ts';
import {
  type EditorMcpServer,
  type EditorMcpServerValues,
  type EntryLevel,
} from '../../types/editor.ts';
import { resolution } from '../levels.ts';

function catalogOf(level: Level): Record<string, unknown> {
  const swarm = isMapping(level.tree) ? level.tree.swarm : undefined;
  return isMapping(swarm) && isMapping(swarm.mcp_servers) ? swarm.mcp_servers : {};
}

function valuesOf(server: CatalogMcpServer | undefined): EditorMcpServerValues | null {
  if (!server) return null;
  return {
    command: server.command,
    args: server.args,
    envNames: Object.keys(server.env).sort(),
    allSpecialists: server.allSpecialists,
  };
}

/**
 * The servers of the catalog with the level each comes from and the specialists that get it.
 * The values of `env` stay here: only the sorted names of the variables go out. A server that
 * does not pass validation is left out.
 */
export function editorMcpServers(
  paths: ConfigPaths,
  global: Level,
  project: Level,
): EditorMcpServer[] {
  const shared = catalogOf(global);
  const own = catalogOf(project);
  const catalog = checkMcpCatalog({ errors: [] }, { ...shared, ...own });
  const sharedCatalog = checkMcpCatalog({ errors: [] }, shared);
  const { config } = resolution(global, project);
  return Object.entries(catalog)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, server]) => {
      const level: EntryLevel =
        name in own ? (name in shared ? 'project_over_global' : 'project') : 'global';
      return {
        name,
        command: server.command,
        args: server.args,
        envNames: Object.keys(server.env).sort(),
        allSpecialists: server.allSpecialists,
        level,
        file: settingsFile(paths, level === 'global' ? 'global' : 'project'),
        shared: valuesOf(sharedCatalog[name]),
        specialists: (config?.specialists ?? [])
          .filter((item) => server.allSpecialists || item.mcpServers?.includes(name))
          .map((item) => item.slug)
          .sort(),
      };
    });
}
