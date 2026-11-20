import type { AccessPolicy, AccessRule } from '../../swarm-config/types/index.ts';
import { patternMatches } from './actions.ts';
import { presetRules } from './presets.ts';

/** Who asks: the id of the user and the attributes the provider or the administrator set. */
export interface Subject {
  id: string;
  attributes: Record<string, string[]>;
}

/** What the action is done to; a field that is not set is an attribute the resource lacks. */
export interface Resource {
  /** The slug of the project; `null` for a call that has no project. */
  repository?: string | null;
  author?: string | null;
  pipeline?: string | null;
  /** The names of the tags. */
  tags?: string[];
}

export interface RuleMatch {
  id: string;
  effect: 'allow' | 'deny';
}

export interface Decision {
  effect: 'allow' | 'deny';
  /** Every rule and preset that matched, whatever its effect. */
  matched: RuleMatch[];
  /** Why: `deny`, `allow` or `default` (nothing matched). */
  reason: 'deny' | 'allow' | 'default';
}

/** The attributes of the subject with the default role standing for a missing `role`. */
export function withDefaultRole(
  attributes: Record<string, string[]>,
  defaultRole: string | null,
): Record<string, string[]> {
  if (defaultRole === null || (attributes.role ?? []).length > 0) return attributes;
  return { ...attributes, role: [defaultRole] };
}

function subjectMatches(rule: AccessRule, subject: Subject): boolean {
  return Object.entries(rule.subject).every(([name, wanted]) =>
    (subject.attributes[name] ?? []).some((value) => wanted.includes(value)),
  );
}

function resourceMatches(rule: AccessRule, subject: Subject, resource: Resource): boolean {
  const { repository, pipeline, tags, author } = rule.resource;
  if (repository !== undefined) {
    const slug = resource.repository;
    if (slug === undefined || slug === null) return false;
    if (!repository.includes('*') && !repository.includes(slug)) return false;
  }
  if (pipeline !== undefined) {
    if (resource.pipeline === undefined || resource.pipeline === null) return false;
    if (!pipeline.includes(resource.pipeline)) return false;
  }
  if (tags !== undefined && !(resource.tags ?? []).some((tag) => tags.includes(tag))) return false;
  if (author === 'self') {
    if (resource.author === undefined || resource.author === null) return false;
    if (resource.author !== subject.id) return false;
  }
  return true;
}

/**
 * The decision for one action: a matching `deny` refuses, else a matching `allow` lets it pass,
 * else it is refused. The order of the rules does not matter.
 */
export function evaluate(
  policy: AccessPolicy,
  subject: Subject,
  action: string,
  resource: Resource,
  defaultRole: string | null = null,
): Decision {
  const seen: Subject = {
    id: subject.id,
    attributes: withDefaultRole(subject.attributes, defaultRole),
  };
  const rules = [...(policy.presets ? presetRules() : []), ...policy.rules];
  const matched: RuleMatch[] = rules
    .filter(
      (rule) =>
        rule.actions.some((pattern) => patternMatches(pattern, action)) &&
        subjectMatches(rule, seen) &&
        resourceMatches(rule, seen, resource),
    )
    .map((rule) => ({ id: rule.id, effect: rule.effect }));
  if (matched.some((rule) => rule.effect === 'deny'))
    return { effect: 'deny', matched, reason: 'deny' };
  if (matched.length > 0) return { effect: 'allow', matched, reason: 'allow' };
  return { effect: 'deny', matched, reason: 'default' };
}
