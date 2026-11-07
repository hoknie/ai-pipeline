import type { Queue } from '../types/index.ts';

/** Tells the clients of the daemon about the queues. */
export interface QueuePublishPort {
  /** The queue was saved: the clients get it as it is now. */
  queueSaved(queue: Queue): void;
  /** The queue may look different without a change of its own: the clients get it when it does. */
  queueChecked(queue: Queue): void;
}
