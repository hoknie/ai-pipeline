import { useEffect, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConnectionView } from '../../../shared/api/types.ts';

import type { McpRow } from './useMcpServers.ts';

/** The connections of the catalog servers by name: loaded once, and only when a server needs one. */
export function useConnectionStates(
  api: Api,
  rows: readonly McpRow[],
): ReadonlyMap<string, ConnectionView> | null {
  const wanted = rows.some((row) => row.connection !== null);
  const [connections, setConnections] = useState<ConnectionView[] | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    api
      .integrations()
      .then((overview) => {
        if (current) setConnections(overview.connections);
      })
      .catch(() => {
        if (current) setConnections([]);
      });
    return () => {
      current = false;
    };
  }, [api, wanted]);
  if (connections === null) return null;
  // The shared and the project connections of one name: the enabled one tells how the server works.
  const byName = new Map<string, ConnectionView>();
  for (const connection of connections) {
    if (connection.kind !== 'service-registry') continue;
    const known = byName.get(connection.name);
    if (known === undefined || (!known.enabled && connection.enabled)) {
      byName.set(connection.name, connection);
    }
  }
  return byName;
}
