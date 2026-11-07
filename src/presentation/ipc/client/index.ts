export {
  checkDaemon,
  daemonMismatchMessage,
  ensureDaemon,
  pingDaemon,
  spawnDaemon,
  stopDaemon,
  type EnsureOptions,
  type StopOptions,
  type StopResult,
} from './autostart.ts';
export { DaemonUnavailable, IpcError, request, subscribe } from './client.ts';
