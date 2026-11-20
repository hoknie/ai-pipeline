import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { isRegistrySkill } from '../../swarm-config/types/index.ts';

export function skillCandidates(name: string, directories: string[]): string[] {
  const parts = name.split(':');
  const leaf = parts.at(-1) ?? name;
  const nested = parts.join('/');
  return directories.flatMap((directory) => [
    join(directory, name, 'SKILL.md'),
    join(directory, leaf, 'SKILL.md'),
    join(directory, `${name}.md`),
    join(directory, `${nested}.md`),
  ]);
}

/** Local skills with no file in the directories; `registry:` skills are the business of the run. */
export function missingSkills(skills: string[], directories: string[]): string[] {
  return skills.filter(
    (skill) =>
      !isRegistrySkill(skill) &&
      !skillCandidates(skill, directories).some((path) => existsSync(path)),
  );
}
