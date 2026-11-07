import { linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { AppError, unavailable } from '../platform/errors/index.ts';
import { ensureDirectory, lockPath as daemonLockPath } from '../platform/paths/index.ts';
import { serveDaemon } from '../presentation/ipc/server.ts';

import { createApplication, type Application, type ApplicationOptions } from './application.ts';

export class AlreadyRunning extends AppError {
  constructor(pid: number) {
    super('conflict', `already running (pid ${pid})`, { code: 'daemon.already_running' });
    this.name = 'AlreadyRunning';
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes the daemon lock. The file is created exclusively, so of two daemons started at the same
 * moment only one gets it; a lock left by a dead process is removed and taken again.
 */
export function acquireLock(path: string): void {
  // Written in full first, then linked: a reader never sees a lock without its pid.
  const draft = `${path}.${process.pid}`;
  writeFileSync(draft, String(process.pid), { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        linkSync(draft, path);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const pid = Number(readFileSync(path, 'utf8').trim());
      if (pid === process.pid) return;
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) throw new AlreadyRunning(pid);
      rmSync(path, { force: true });
    }
  } finally {
    rmSync(draft, { force: true });
  }
  throw unavailable('daemon.lock', `cannot take the daemon lock ${path}`);
}

export interface RunningDaemon {
  application: Application;
  close(): Promise<void>;
  closed: Promise<void>;
}

/** Takes the lock, builds the application and serves it on the daemon socket. */
export async function startDaemon(options: ApplicationOptions): Promise<RunningDaemon> {
  ensureDirectory(options.stateDirectory);
  const lockPath = daemonLockPath(options.stateDirectory);
  acquireLock(lockPath);
  const application = createApplication(options);
  try {
    const served = await serveDaemon(application, {
      lockPath,
      socketCheckMs: options.socketCheckMs,
    });
    return { application, ...served };
  } catch (error) {
    await application.stop().catch(() => undefined);
    rmSync(lockPath, { force: true });
    throw error;
  }
}
