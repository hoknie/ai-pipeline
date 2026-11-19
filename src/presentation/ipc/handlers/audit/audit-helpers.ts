import { AUDIT_TEXT_LIMIT, clipText } from '../../../../feature/audit/types/index.ts';
import type { IpcContext } from '../types.ts';

type Params = Record<string, unknown>;

/** What a call tells the journal besides the action. */
export interface AuditInfo {
  /** The user the entry is about when the caller is not that user (a sign-in by a link). */
  subject?: string;
  /** The path of the project; `null`: the call has none. */
  repository?: string | null;
  resource?: { kind: string; id: string } | null;
  details?: Record<string, unknown>;
}

/** How one method is written to the journal. */
export interface AuditRow {
  /** The action: its name, or by the parameters (the level of a setting). */
  action: string | ((params: Params) => string);
  /** The name in the journal when it differs from the action (the methods of accounts). */
  event?: string;
  /** The name in the journal when the call failed (a refused sign-in). */
  failedEvent?: string;
  /** The project, resource and details; the project defaults to the one of `repository`, `runId`, `path`. */
  info?: (params: Params, result: unknown, context: IpcContext) => AuditInfo;
}

/** The text of a field as the journal keeps it: cut to the limit. */
export const text = (value: unknown): unknown =>
  typeof value === 'string' ? clipText(value, AUDIT_TEXT_LIMIT) : value;

/** The listed fields of the parameters that are present, as the journal keeps them. */
export function pick(params: Params, ...names: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of names) if (params[name] !== undefined) out[name] = text(params[name]);
  return out;
}

/** The names of the fields that are set: what an edit touched, not the values. */
export function touched(params: Params, ...skip: string[]): string[] {
  return Object.keys(params).filter((name) => params[name] !== undefined && !skip.includes(name));
}

export const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** `of` as a resource, `null` when the id is not there. */
export function resource(kind: string, id: unknown): AuditInfo['resource'] {
  return typeof id === 'string' || typeof id === 'number' ? { kind, id: String(id) } : null;
}

export const runOf = (params: Params): AuditInfo => ({ resource: resource('run', params.runId) });

export const runWith =
  (...names: string[]) =>
  (params: Params): AuditInfo => ({ ...runOf(params), details: pick(params, ...names) });

/** The settings level in the action: the shared one writes `config.global.write`. */
export const levelAction = (global: (params: Params) => boolean) => (params: Params) =>
  global(params) ? 'config.global.write' : 'config.write';

export const explicitGlobal = (params: Params) => params.level === 'global';
export const defaultGlobal = (params: Params) => (params.level ?? 'global') === 'global';
export const sharedTags = (params: Params) => params.repository === null;

export const configInfo = (params: Params, global: boolean): AuditInfo => ({
  ...(global ? { repository: null } : {}),
  resource:
    typeof params.kind === 'string' && typeof params.id === 'string'
      ? { kind: params.kind, id: params.id }
      : null,
  details: { level: global ? 'global' : 'project', ...pick(params, 'kind', 'id', 'name', 'path') },
});

/** The email of an account call: the account it concerns. */
export const account = (params: Params): AuditInfo => ({
  repository: null,
  resource: resource('user', params.email),
});

/** A sign-in or a sign-out: who it was comes with the answer, how it came with the method. */
export function signIn(method: string) {
  return (params: Params, result: unknown): AuditInfo => {
    const user = (result as { user?: { id?: string; email?: string } } | null)?.user;
    return {
      ...(user?.id ? { subject: user.id } : {}),
      repository: null,
      resource: user?.id ? { kind: 'user', id: user.id } : null,
      details: {
        method,
        ...(user?.email ? { email: user.email } : {}),
        ...(typeof params.address === 'string' ? { address: params.address } : {}),
      },
    };
  };
}
