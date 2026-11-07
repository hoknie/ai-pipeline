import type { BackgroundProcessView } from '../types/index.ts';

/** Tells the subscribers of the daemon about the background processes. */
export interface ProcessesPublishPort {
  /** Someone listens: without subscribers the processes are not watched. */
  hasSubscribers(): boolean;
  processesChanged(payload: { processes: BackgroundProcessView[] } | { error: string }): void;
}
