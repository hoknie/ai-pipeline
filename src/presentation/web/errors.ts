import { AppError, invalid, type ErrorKind } from '../../platform/errors/index.ts';
import { IpcError } from '../ipc/client/index.ts';

/** Kinds a panel error may have; each has one HTTP status. */
export type PanelKind = Extract<
  ErrorKind,
  | 'invalid'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'too_large'
  | 'unsupported'
>;

export const PANEL_STATUS: Record<PanelKind, number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  too_large: 413,
  unsupported: 415,
};

/** An error of the panel itself; `responseCode` becomes the `code` of the answer. */
export class PanelError extends AppError {
  declare readonly kind: PanelKind;

  constructor(kind: PanelKind, message: string, responseCode?: string) {
    super(kind, message, {
      code: 'web.panel',
      ...(responseCode === undefined ? {} : { responseCode }),
    });
    this.name = 'PanelError';
  }
}

/**
 * The status of an error the daemon sent back. The daemon sends text only, so the status is read
 * from the text; add no new patterns here, pass a code through the socket instead.
 */
export function daemonErrorStatus(message: string): number {
  if (
    /^(unknown (run|group|attempt|queue item|artifact|attachment)\b|not a background process)/.test(
      message,
    )
  )
    return 404;
  if (/is not changed in group/.test(message)) return 404;
  if (/has no merged changes|is not available/.test(message)) return 409;
  if (/^aip daemon did not answer/.test(message)) return 504;
  if (message.startsWith('malformed response')) return 502;
  return 400;
}

/** The status and the body of the answer to a failure of a request. */
export function renderPanelError(error: unknown): {
  status: number;
  body: { error: string; code?: string };
} {
  if (error instanceof IpcError)
    return { status: daemonErrorStatus(error.message), body: { error: error.message } };
  if (error instanceof PanelError) {
    return {
      status: PANEL_STATUS[error.kind],
      body: {
        error: error.message,
        ...(error.responseCode === undefined ? {} : { code: error.responseCode }),
      },
    };
  }
  return { status: 502, body: { error: (error as Error).message } };
}

/** Shorthand for `new PanelError`. */
export const panel = (kind: PanelKind, message: string, responseCode?: string): PanelError =>
  new PanelError(kind, message, responseCode);

export const TOKEN_HINT = 'open the URL printed by `aip web`: it contains the access token';

/** A wrong setting of the panel: the host or the token. */
export const configError = (message: string): AppError => invalid('web.config', message);
