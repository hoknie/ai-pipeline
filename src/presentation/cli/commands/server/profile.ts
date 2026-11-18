import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

import { remoteProfilePath } from '../../../../platform/paths/index.ts';
import type { RemoteDaemon } from '../../../ipc/client/index.ts';

const profileSchema = z.object({
  url: z.string().min(1),
  token: z.string().min(1),
  email: z.string().min(1),
});

/** The server `aip login` saved: its address, the personal token and the email of the owner. */
export type RemoteProfile = z.infer<typeof profileSchema>;

/** The saved profile; `null` when there is none or the file is broken. */
export function readProfile(environment: NodeJS.ProcessEnv): RemoteProfile | null {
  try {
    return profileSchema.parse(JSON.parse(readFileSync(remoteProfilePath(environment), 'utf8')));
  } catch {
    return null;
  }
}

/** Writes the profile for its owner only (`0600`): it holds a token. */
export function writeProfile(environment: NodeJS.ProcessEnv, profile: RemoteProfile): void {
  const path = remoteProfilePath(environment);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function removeProfile(environment: NodeJS.ProcessEnv): void {
  rmSync(remoteProfilePath(environment), { force: true });
}

/** The server the commands talk to: `AIP_SERVER` with `AIP_TOKEN`, else the saved profile. */
export function remoteOf(environment: NodeJS.ProcessEnv): RemoteDaemon | null {
  const url = environment.AIP_SERVER;
  const token = environment.AIP_TOKEN;
  if (url && token) return { url, token };
  const profile = readProfile(environment);
  return profile === null ? null : { url: profile.url, token: profile.token };
}
