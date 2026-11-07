/** The run, group and step an agent belongs to, whose process left a background process. */
export interface BackgroundOwner {
  runId: string;
  runTitle: string;
  repository: string;
  group: string | null;
  groupTitle: string | null;
  step: string | null;
}

/** A process started by an agent (or left in its process group). */
export interface BackgroundProcessView {
  pid: number;
  /** Executable name without the directory. */
  name: string;
  /** Full command line. */
  command: string;
  uptimeSeconds: number;
  /** CPU time over the lifetime of the process, percent of one core. */
  cpuPercent: number;
  /** Resident memory. */
  memoryBytes: number;
  owner: BackgroundOwner;
}

export interface BackgroundProcessesView {
  processes: BackgroundProcessView[];
}
