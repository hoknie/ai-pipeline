/** What kind of a failure it is; a transport maps the kind to its own answer. */
export type ErrorKind =
  | 'invalid'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'rejected'
  | 'forbidden'
  | 'too_large'
  | 'unsupported'
  | 'method_not_allowed'
  | 'unavailable'
  | 'internal';

export interface AppErrorOptions {
  /** Identifier declared by the owner of the error, e.g. `core.rejected`. */
  code: string;
  /** The `code` field of a panel answer; absent for most errors. */
  responseCode?: string;
  cause?: unknown;
}

/** An expected failure: a refused request, a broken input, a missing resource. */
export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly responseCode: string | undefined;

  constructor(kind: ErrorKind, message: string, options: AppErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.kind = kind;
    this.code = options.code;
    this.responseCode = options.responseCode;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** The text of any thrown value: the message of an error, `String` of anything else. */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  const message = (value as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : String(value);
}

/** A request the state does not allow: wrong status, empty field, unknown name. */
export function rejected(message: string, code = 'app.rejected'): AppError {
  return new AppError('rejected', message, { code });
}

export function isRejected(value: unknown): value is AppError {
  return value instanceof AppError && value.kind === 'rejected' && value.code === 'app.rejected';
}

/** Shorthand for an expected failure of the given kind, with the code of its owner. */
export function appError(kind: ErrorKind, code: string, message: string): AppError {
  return new AppError(kind, message, { code });
}

export const invalid = (code: string, message: string): AppError =>
  appError('invalid', code, message);
export const notFound = (code: string, message: string): AppError =>
  appError('not_found', code, message);
export const conflict = (code: string, message: string): AppError =>
  appError('conflict', code, message);
export const unavailable = (code: string, message: string): AppError =>
  appError('unavailable', code, message);
