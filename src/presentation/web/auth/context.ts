import { AsyncLocalStorage } from 'node:async_hooks';

/** The user a request of the panel works for; the calls to the daemon made inside it carry it. */
export interface RequestContext {
  actor: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
