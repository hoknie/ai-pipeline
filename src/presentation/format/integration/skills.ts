import type { RegistrySkillView } from '../../ipc/contract/index.ts';
import { type Style, plainStyle } from '../style.ts';
import { table } from '../table.ts';

/** The skills of a registry: how to name them in `skills` of a specialist, and their versions. */
export function formatRegistrySkills(
  skills: readonly RegistrySkillView[],
  style: Style = plainStyle,
): string {
  if (skills.length === 0) return 'The registry offers no skills for this query.';
  return table(
    [
      ['SKILL', 'TITLE', 'VERSIONS', 'TAGS'],
      ...skills.map((skill) => [
        style.argument(`registry:${skill.name}`),
        skill.title === skill.name ? '—' : skill.title,
        skill.versions.join(', ') || '—',
        skill.tags.join(', ') || '—',
      ]),
    ],
    style,
  );
}
