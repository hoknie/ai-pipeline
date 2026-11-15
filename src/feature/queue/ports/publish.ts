import type { RunState } from '../../runs/types/index.ts';
import type { Queue } from '../types/index.ts';

/** Tells the clients of the daemon about the queues. */
export interface QueuePublishPort {
  /** The queue was saved: the clients get it as it is now. */
  queueSaved(queue: Queue): void;
  /** The queue may look different without a change of its own: the clients get it when it does. */
  queueChecked(queue: Queue): void;
  /** The links of the run changed: the clients get the run as it is now. */
  runChanged(state: RunState): void;
  /** The global queue was saved: the clients get it as it is now. */
  globalQueueSaved(): void;
  /** The global queue may look different without a change of its own: the clients get it when it does. */
  globalQueueChecked(): void;
}
