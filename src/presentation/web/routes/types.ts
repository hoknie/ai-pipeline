import type { IncomingMessage, ServerResponse } from 'node:http';

import type { DaemonCheck, Method, ParamsOf } from '../../ipc/contract/index.ts';
import type { WebOptions } from '../options.ts';

export const segment = '([^/]+)';

export type Handler = (
  match: string[],
  body: unknown,
  repository: string,
  query: URLSearchParams,
) => Promise<unknown>;

/** A JSON route: the server checks the host and the token, reads the body and the repository. */
export interface Route {
  method: string;
  pattern: RegExp;
  handle: Handler;
}

export type Call = <M extends Method>(method: M, params: ParamsOf<M>) => Promise<unknown>;

/** What the routes get from the server. */
export interface RouteKit {
  call: Call;
  options: WebOptions;
  host: string;
  /** The port the server listens on; known once it listens. */
  port(): number;
  /** Where uploaded files wait for the task that uses them. */
  uploads: string;
  /** Whether the panel runs without a token. */
  open: boolean;
  ensureDaemon(): Promise<DaemonCheck>;
}

/** A route that answers on its own: downloads, the repository list and the system view. */
export interface RawRoute {
  pattern: RegExp;
  handle(request: {
    incoming: IncomingMessage;
    response: ServerResponse;
    url: URL;
    match: RegExpExecArray;
    verb: string;
  }): Promise<void>;
}
