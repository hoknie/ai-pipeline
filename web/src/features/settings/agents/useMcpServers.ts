import { useCallback } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type {
  ConfigEditResult,
  ConfigEditorResponse,
  EditorMcpServer,
  EntryLevel,
  McpServerValue,
} from '../../../shared/api/types.ts';
import type { SettingsScope } from '../../../shared/lib/nav/settingsGroups.ts';

/** A server of the catalog as the tab of a level shows it. */
export interface McpRow {
  name: string;
  command: string;
  args: string[];
  envNames: string[];
  allSpecialists: boolean;
  level: EntryLevel;
  /** How many specialists get the server. */
  specialists: number;
  /** The level of the tab defines it; a shared server of the project tab is read only. */
  editable: boolean;
}

/** The servers the tab of `scope` lists: the shared tab shows shared definitions, the project tab all. */
export function mcpRows(servers: EditorMcpServer[], scope: SettingsScope): McpRow[] {
  const rows: McpRow[] = [];
  for (const server of servers) {
    const values = scope === 'global' ? server.shared : server;
    if (values === null) continue;
    rows.push({
      name: server.name,
      command: values.command,
      args: values.args,
      envNames: values.envNames,
      allSpecialists: values.allSpecialists,
      level: server.level,
      specialists: server.specialists.length,
      editable: scope === 'global' || server.level !== 'global',
    });
  }
  return rows;
}

/** Writes and removes the servers of the level of the tab, with the revision the tab has seen. */
export function useMcpServers(
  api: Api,
  config: ConfigEditorResponse,
  scope: SettingsScope,
  reload: () => Promise<void>,
) {
  const revision = config.settingsFiles[scope].revision;
  const save = useCallback(
    async (name: string, value: McpServerValue): Promise<ConfigEditResult> => {
      const result = await api.writeMcpServer(name, value, revision, scope);
      if (result.ok) await reload();
      return result;
    },
    [api, revision, scope, reload],
  );
  const remove = useCallback(
    async (name: string): Promise<ConfigEditResult> => {
      if (revision === null) return { ok: false, reason: 'conflict', message: 'no file' };
      const result = await api.deleteMcpServer(name, revision, scope);
      if (result.ok) await reload();
      return result;
    },
    [api, revision, scope, reload],
  );
  return { rows: mcpRows(config.mcpServers, scope), save, remove };
}
