import { createContext, useContext } from 'react';

import type { QueueView } from '../../../shared/api/types.ts';

/** What the queue page knows about the other projects: their queues and a way to open one. */
export interface QueueLinks {
  /** The queues of the other enabled projects: their tasks and runs can be waited for. */
  others: readonly QueueView[];
  /** Makes the project the panel's repository and opens its queue. */
  openProject?: ((path: string) => void) | undefined;
}

const NONE: QueueLinks = { others: [] };

export const QueueLinksContext = createContext<QueueLinks>(NONE);

export const useQueueLinks = (): QueueLinks => useContext(QueueLinksContext);
