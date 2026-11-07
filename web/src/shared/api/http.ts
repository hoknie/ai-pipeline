/**
 * The HTTP calls behind the API of the panel: every request carries the cookie, an answer that
 * is not an outcome of the request is an `ApiError`.
 */
import type { ConfigEditResult, WriteLevel } from './types.ts';

export class ApiError extends Error {
  readonly status: number;
  /** Machine-readable reason of the refusal, such as `daemon_busy`. */
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!response.ok)
    throw new ApiError(response.status, body.error ?? response.statusText, body.code);
  return body as T;
}

export function post<T>(path: string, body: unknown = {}): Promise<T> {
  return call<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A request with a JSON body. */
export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const enc = encodeURIComponent;
export const levelQuery = (level?: WriteLevel) => (level ? `&level=${level}` : '');

/** 200, 422 (errors) and 409 (conflict) are outcomes of an edit; anything else is a failure. */
export async function edit(path: string, init: RequestInit): Promise<ConfigEditResult> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 200) return body as unknown as ConfigEditResult;
  if (response.status === 422) {
    return {
      ok: false,
      reason: 'invalid',
      errors: (body.errors ?? []) as never,
      references: (body.references ?? []) as never,
    };
  }
  if (response.status === 409) {
    return { ok: false, reason: 'conflict', message: String(body.error ?? 'conflict') };
  }
  throw new ApiError(response.status, String(body.error ?? response.statusText));
}

/** The address with `repository=<path>` added (`null` leaves it as it is). */
export function withRepository(path: string, repository: string | null): string {
  if (repository === null) return path;
  return `${path}${path.includes('?') ? '&' : '?'}repository=${enc(repository)}`;
}
