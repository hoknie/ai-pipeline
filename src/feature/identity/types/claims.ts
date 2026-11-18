import type { Attributes } from './user.ts';

export type Claims = Record<string, unknown>;

/** A claim as a list of strings: a string is one element, an array its strings, a missing claim nothing. */
export function claimValues(claims: Claims, name: string): string[] {
  const value = claims[name];
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item !== '');
  }
  return [];
}

/** The first string of a claim, or `null`. */
export function claimText(claims: Claims, name: string): string | null {
  return claimValues(claims, name)[0] ?? null;
}

/** The user attributes of the claims: attribute name → claim name; a missing claim gives an empty list. */
export function mapAttributes(claims: Claims, mapping: Record<string, string>): Attributes {
  const attributes: Attributes = {};
  for (const [attribute, claim] of Object.entries(mapping)) {
    const values = claimValues(claims, claim);
    attributes[attribute] = values;
  }
  return attributes;
}

/** `email_verified` as a boolean; some providers send the text `"true"`. */
export function emailVerified(claims: Claims): boolean {
  const value = claims.email_verified;
  return value === true || value === 'true';
}

/** The domain of an email in lower case, or `null`. */
export function emailDomain(email: string): string | null {
  const index = email.lastIndexOf('@');
  return index < 0
    ? null
    : email
        .slice(index + 1)
        .trim()
        .toLowerCase();
}
