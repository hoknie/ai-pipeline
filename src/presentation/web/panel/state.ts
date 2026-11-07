import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

/** The panel of the daemon (or its stand-in), as written to `<state>/web.json`. */
export interface PanelState {
  pid: number;
  host: string;
  port: number;
  auth: 'token' | 'none';
  token: string | null;
  url: string;
  /** Set by the stand-in that serves the panel while the daemon is stopped. */
  standby?: boolean;
}

const panelStateSchema = z.object({
  pid: z.number().int().positive(),
  host: z.string(),
  port: z.number().int(),
  auth: z.enum(['token', 'none']),
  token: z.string().nullable(),
  url: z.string(),
  standby: z.boolean().optional(),
});

export function panelStatePath(stateDirectory: string): string {
  return join(stateDirectory, 'web.json');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Writes the file through a temporary one, readable by the user only. */
export function writePanelState(stateDirectory: string, state: PanelState): void {
  const path = panelStatePath(stateDirectory);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

/** The state of a running panel; null when there is no file, it is broken or its process is dead. */
export function readPanelState(stateDirectory: string): PanelState | null {
  const path = panelStatePath(stateDirectory);
  if (!existsSync(path)) return null;
  try {
    const state = panelStateSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return alive(state.pid) ? state : null;
  } catch {
    return null;
  }
}

/** The token a previous panel used, even when its process is gone. */
export function previousPanelToken(stateDirectory: string): string | null {
  try {
    const state = panelStateSchema.parse(
      JSON.parse(readFileSync(panelStatePath(stateDirectory), 'utf8')),
    );
    return state.token;
  } catch {
    return null;
  }
}

/** Removes the file if it belongs to the process `pid`. */
export function removePanelState(stateDirectory: string, pid: number): void {
  const path = panelStatePath(stateDirectory);
  try {
    const state = panelStateSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (state.pid !== pid) return;
  } catch {
    return;
  }
  rmSync(path, { force: true });
}
