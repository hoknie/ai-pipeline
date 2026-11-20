/** `allow` lets an action pass, `deny` refuses it whatever else allows. */
export type AccessEffect = 'allow' | 'deny';

export const ACCESS_EFFECTS: readonly AccessEffect[] = ['allow', 'deny'];

/** What a rule requires of the resource; every condition that is set must hold. */
export interface ResourceCondition {
  /** Slugs of projects; `*` means any project. */
  repository?: string[];
  pipeline?: string[];
  /** Names of tags: at least one of them. */
  tags?: string[];
  /** The author of the resource is the user who asks. */
  author?: 'self';
}

/** One rule of `access.yaml` (or of a preset). */
export interface AccessRule {
  id: string;
  effect: AccessEffect;
  /** Names of actions or patterns with `*`. */
  actions: string[];
  /** Attribute name → the values of which the user must have at least one. */
  subject: Record<string, string[]>;
  resource: ResourceCondition;
}

/** The policy of `access.yaml`. */
export interface AccessPolicy {
  /** The built-in presets of the roles act next to the rules. */
  presets: boolean;
  rules: AccessRule[];
}

export function defaultAccessPolicy(): AccessPolicy {
  return { presets: true, rules: [] };
}

export const ACCESS_FILE_NAME = 'access.yaml';

export const ACCESS_ROLES = ['admin', 'developer', 'viewer'] as const;

export type AccessRole = (typeof ACCESS_ROLES)[number];

export function isAccessRole(value: string): value is AccessRole {
  return (ACCESS_ROLES as readonly string[]).includes(value);
}
