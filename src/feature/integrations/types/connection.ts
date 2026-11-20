import { refusal } from './errors.ts';
import type { InboundOperation } from './operations.ts';

export type ConnectionScope = 'project' | 'global';
/** What happened to a connection that others live by. */
export type ConnectionChange = 'params' | 'enabled' | 'disabled' | 'secret' | 'removed';
export type ConnectionState = 'ready' | 'cleanup_pending';
export type Direction = 'inbound' | 'outbound';

/** A non-secret parameter a kind accepts. */
export interface ParamSpec {
  name: string;
  required: boolean;
  maxLength: number;
  /** The only allowed values; absent: any text up to `maxLength`. */
  values?: readonly string[];
  /** A regular expression the whole value must match; absent: any text up to `maxLength`. */
  pattern?: string;
  /** A check of the kind for what a pattern cannot say; the value passed the limits above already. */
  validate?: (value: string) => boolean;
  /** The parameter is the identity of something outside; it never changes after the connection is made. */
  immutable?: boolean;
}

/** A secret a kind keeps in the secret store. */
export interface SecretSpec {
  slot: string;
  required: boolean;
  /** Whether a value is acceptable; a kind with a format of its own checks it here. */
  validate?: (value: string) => boolean;
}

/** What an installed version knows about one kind of connections. */
export interface AdapterDescriptor {
  kind: string;
  title: string;
  params: readonly ParamSpec[];
  secrets: readonly SecretSpec[];
  directions: readonly Direction[];
  /** Typed inbound operations a verified event of this kind may ask for. */
  operations: readonly InboundOperation['type'][];
  /** The command that creates connections of this kind; the general `add` refuses them. */
  createdBy?: string;
}

/** A connection as the registry keeps it: no secret values, only what is needed to find them. */
export interface Connection {
  id: string;
  kind: string;
  name: string;
  scope: ConnectionScope;
  /** Root of the project of a `project` connection; null for a `global` one. */
  projectPath: string | null;
  params: Record<string, string>;
  enabled: boolean;
  state: ConnectionState;
  createdAt: number;
  updatedAt: number;
  /** The outcome of the last connection check; null: never checked. */
  lastCheck: ConnectionCheck | null;
}

/** The recorded outcome of a connection check: a static code and a count, never a response text. */
export interface ConnectionCheck {
  at: number;
  ok: boolean;
  code: string | null;
  count: number | null;
}

/** What an adapter's check reports; `code` is one of its own static codes. */
export interface CheckResult {
  ok: boolean;
  code?: string;
  count?: number;
}

export interface SecretStatus {
  slot: string;
  required: boolean;
  present: boolean;
}

/** The safe answer about a connection: names and presence of secrets, never values. */
export interface ConnectionView {
  id: string;
  kind: string;
  name: string;
  scope: ConnectionScope;
  project: string | null;
  params: Record<string, string>;
  enabled: boolean;
  state: ConnectionState;
  secrets: SecretStatus[];
  /** A secret operation or a cleanup is not finished: the connection does no work. */
  pending: boolean;
  lastCheck: ConnectionCheck | null;
}

export interface CatalogEntry {
  kind: string;
  title: string;
  params: readonly ParamSpec[];
  secrets: readonly SecretSpec[];
  directions: readonly Direction[];
  operations: readonly string[];
}

export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;
export const SLOT_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
export const SECRET_LIMIT = 16 * 1024;

export function validateName(name: string): void {
  if (!NAME_PATTERN.test(name)) throw refusal('invalid_name');
}

/** Refuses unknown parameters, missing required ones and values the kind does not accept. */
export function validateParams(
  descriptor: AdapterDescriptor,
  params: Record<string, string>,
): Record<string, string> {
  const known = new Map(descriptor.params.map((spec) => [spec.name, spec]));
  for (const [name, value] of Object.entries(params)) {
    const spec = known.get(name);
    if (spec === undefined) throw refusal('invalid_params');
    if (typeof value !== 'string' || value.length > spec.maxLength) {
      throw refusal('invalid_params', name);
    }
    if (spec.values !== undefined && !spec.values.includes(value)) {
      throw refusal('invalid_params', name);
    }
    if (spec.validate !== undefined && !spec.validate(value)) {
      throw refusal('invalid_params', name);
    }
    if (spec.pattern !== undefined && !new RegExp(`^(?:${spec.pattern})$`, 'u').test(value)) {
      throw refusal('invalid_params', name);
    }
  }
  for (const spec of descriptor.params) {
    if (spec.required && !(spec.name in params)) throw refusal('invalid_params', spec.name);
  }
  return { ...params };
}

/** Refuses a value the kind cannot use as the secret of the slot. */
export function checkSecretFormat(spec: SecretSpec, value: string): void {
  if (spec.validate !== undefined && !spec.validate(value))
    throw refusal('invalid_secret', spec.slot);
}

export function secretSpec(descriptor: AdapterDescriptor, slot: string): SecretSpec {
  const spec = descriptor.secrets.find((one) => one.slot === slot);
  if (spec === undefined) throw refusal('invalid_slot');
  return spec;
}

export function validateSecretValue(value: string): void {
  if (value.length === 0 || new TextEncoder().encode(value).length > SECRET_LIMIT) {
    throw refusal('invalid_secret');
  }
}

/**
 * The authority of a connection over a project: a project connection serves its own project
 * only; a global one serves any project, and only when the operation names it explicitly.
 */
export function connectionServes(connection: Connection, project: string): boolean {
  return connection.scope === 'global' || connection.projectPath === project;
}

/** The parameters after an edit: the set ones over the old, the unset ones gone, all checked by the kind. */
export function editedParams(
  descriptor: AdapterDescriptor,
  current: Record<string, string>,
  change: { set: Record<string, string>; unset: readonly string[] },
): Record<string, string> {
  const setNames = Object.keys(change.set);
  if (setNames.length === 0 && change.unset.length === 0) throw refusal('nothing_to_change');
  if (change.unset.some((name) => setNames.includes(name))) throw refusal('conflicting_edit');
  const specs = new Map(descriptor.params.map((spec) => [spec.name, spec]));
  for (const name of [...setNames, ...change.unset]) {
    if (descriptor.secrets.some((secret) => secret.slot === name)) {
      throw refusal('secret_param', name);
    }
    const spec = specs.get(name);
    if (spec === undefined) throw refusal('invalid_params');
    if (spec.immutable === true) throw refusal('immutable_param', name);
  }
  const merged = { ...current, ...change.set };
  for (const name of change.unset) delete merged[name];
  return validateParams(descriptor, merged);
}
