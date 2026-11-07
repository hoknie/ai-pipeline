import { NAMING_TIMEOUT_MS, USAGE_INTERVAL_MS } from './executor.ts';
import { KILL_GRACE_MS } from './processes.ts';
import { DRAIN_MS, STOP_GRACE_MS } from './supervisor.ts';

/** A timer fires this long after a usage limit resets, so the reset has surely passed. */
const WAKE_MARGIN_MS = 1000;
/** How often the daemon looks at background processes while someone is subscribed. */
const PROCESS_STREAM_MS = 2000;
/** Pause between a SIGTERM and the extra look at background processes. */
const PROCESS_KILL_LOOK_MS = 250;

/** Every duration the daemon waits for; tests shorten them. */
export interface DaemonTimings {
  /** Length of one second of a step's `timeout`. */
  timeoutUnitMs: number;
  /** How long the output of an agent is drained after it exited. */
  drainMs: number;
  /** Time between the stop signal and SIGKILL for an agent. */
  stopGraceMs: number;
  /** Time between SIGTERM and SIGKILL when a background process is killed. */
  killGraceMs: number;
  /** A timer fires this long after a usage limit resets. */
  wakeMarginMs: number;
  /** How often the usage of a running step is saved. */
  usageIntervalMs: number;
  /** The longest the naming agent may run. */
  namingTimeoutMs: number;
  /** How often subscribers get the background processes. */
  processStreamMs: number;
  /** Pause between a SIGTERM and the extra look at background processes. */
  processKillLookMs: number;
  /** How long a snapshot of the process table answers `processes` requests. */
  processCacheMs: number;
}

/** The durations of a daemon without overrides. */
export const DEFAULT_TIMINGS: DaemonTimings = {
  timeoutUnitMs: 1000,
  drainMs: DRAIN_MS,
  stopGraceMs: STOP_GRACE_MS,
  killGraceMs: KILL_GRACE_MS,
  wakeMarginMs: WAKE_MARGIN_MS,
  usageIntervalMs: USAGE_INTERVAL_MS,
  namingTimeoutMs: NAMING_TIMEOUT_MS,
  processStreamMs: PROCESS_STREAM_MS,
  processKillLookMs: PROCESS_KILL_LOOK_MS,
  processCacheMs: 1_000,
};
