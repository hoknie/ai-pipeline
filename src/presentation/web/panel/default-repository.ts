import { request } from '../../ipc/client/index.ts';

/** The default repository of the panel: the enabled project added to the registry last. */
export async function latestRepository(socket: string): Promise<string | null> {
  const repositories = (await request(socket, 'repositories', {})) as {
    path: string;
    addedAt: number;
    enabled?: boolean;
  }[];
  let latest: { path: string; addedAt: number } | null = null;
  for (const entry of repositories) {
    if (entry.enabled === false) continue;
    if (latest === null || entry.addedAt >= latest.addedAt) latest = entry;
  }
  return latest?.path ?? null;
}
