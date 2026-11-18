/** Attributes of a user: a name maps to a list of strings (`role: [admin]`). */
export type Attributes = Record<string, string[]>;

export const USER_SOURCES = ['local', 'oidc', 'saml'] as const;

export type UserSource = (typeof USER_SOURCES)[number];

/** Who the provider calls the user: the issuer and the subject never change for a person. */
export interface UserSubject {
  issuer: string;
  subject: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  attributes: Attributes;
  source: UserSource;
  /** The identity at the external provider of a user of the source `oidc`; `null` otherwise. */
  subject: UserSubject | null;
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

/** The part of a user that travels with a request and an event. */
export interface UserRef {
  id: string;
  email: string;
  name: string;
}

/** Who makes a request to the daemon. */
export type Actor =
  { kind: 'local' } | { kind: 'system' } | { kind: 'user'; user: UserRef; attributes: Attributes };

export const ADMIN_ROLE = 'admin';

export function userRef(user: User): UserRef {
  return { id: user.id, email: user.email, name: user.name };
}

export function actorOf(user: User): Actor {
  return { kind: 'user', user: userRef(user), attributes: user.attributes };
}

export function hasAdminRole(attributes: Attributes): boolean {
  return (attributes.role ?? []).includes(ADMIN_ROLE);
}

/** `local` and `system` act as administrators; a user only with `role: admin`. */
export function isAdmin(actor: Actor): boolean {
  return actor.kind !== 'user' || hasAdminRole(actor.attributes);
}

export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * Attributes from `name=value[,value]` arguments: later arguments replace the same name; an empty
 * value list removes the attribute.
 */
export function parseAttributeArgument(argument: string): [string, string[]] | null {
  const index = argument.indexOf('=');
  if (index <= 0) return null;
  const name = argument.slice(0, index).trim();
  const values = argument
    .slice(index + 1)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  return name === '' ? null : [name, values];
}
