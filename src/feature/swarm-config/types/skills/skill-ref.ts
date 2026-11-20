import { parseRange } from './semver.ts';

/** The prefix that marks a skill of a service registry; no local skill may start with it. */
export const REGISTRY_SKILL_PREFIX = 'registry:';
export const REGISTRY_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u;
export const REGISTRY_RANGE_EXAMPLE = '^1.2, ~1.2, 1.x, >=1 <3';

export interface RegistrySkillRef {
  name: string;
  /** The text after `@`; null: the highest available version. */
  range: string | null;
}

export type RegistrySkillParse =
  { ok: true; ref: RegistrySkillRef } | { ok: false; problem: string };

export function isRegistrySkill(skill: string): boolean {
  return skill.startsWith(REGISTRY_SKILL_PREFIX);
}

/** `registry:<name>` or `registry:<name>@<range>`: the parts, or what is wrong with the text. */
export function parseRegistrySkill(skill: string): RegistrySkillParse {
  const body = skill.slice(REGISTRY_SKILL_PREFIX.length);
  const at = body.indexOf('@');
  const name = at < 0 ? body : body.slice(0, at);
  if (!REGISTRY_SKILL_NAME.test(name)) {
    return {
      ok: false,
      problem: `the skill name "${name}" must match ${REGISTRY_SKILL_NAME.source}`,
    };
  }
  if (at < 0) return { ok: true, ref: { name, range: null } };
  const range = body.slice(at + 1).trim();
  if (range === '' || parseRange(range) === null) {
    return {
      ok: false,
      problem: `"${body.slice(at + 1)}" is not a version range (for example ${REGISTRY_RANGE_EXAMPLE})`,
    };
  }
  return { ok: true, ref: { name, range } };
}

/** The text of a reference for a message: `registry:<name>` and the range when it is set. */
export function registrySkillText(ref: RegistrySkillRef): string {
  return `${REGISTRY_SKILL_PREFIX}${ref.name}${ref.range === null ? '' : `@${ref.range}`}`;
}
