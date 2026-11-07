import { request } from '../../ipc/client/index.ts';

/** The repository added to the registry last, or null while the registry is empty. */
export async function latestRepository(socket: string): Promise<string | null> {
  const repositories = (await request(socket, 'repositories', {})) as {
    path: string;
    addedAt: number;
  }[];
  let latest: { path: string; addedAt: number } | null = null;
  for (const entry of repositories) {
    if (latest === null || entry.addedAt >= latest.addedAt) latest = entry;
  }
  return latest?.path ?? null;
}
