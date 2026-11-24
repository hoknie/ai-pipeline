import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Runtime } from '../../../../agents/types/index.ts';
import { LESSON_SKILL_NAME, type LessonBlock } from '../../../types/index.ts';

import type { AttemptSkills } from './registry.ts';

/** The fixed head of the skill file: it is not a lesson and does not count toward the limit. */
export const LESSONS_SKILL_HEADER = [
  '---',
  `name: ${LESSON_SKILL_NAME}`,
  'description: "Objective lessons from earlier runs of this repository: failed deliveries, denied tool calls and rejected results."',
  '---',
  '',
  '',
].join('\n');

/** The whole `SKILL.md` of the lessons: the fixed head and the capped block. */
export function lessonsSkill(block: LessonBlock): string {
  return `${LESSONS_SKILL_HEADER}${block.text}\n`;
}

/**
 * Adds the lessons to what an attempt gets as skills. A runtime that does not load extra skills is
 * told so in its log; an attempt without lessons gets exactly what it got before.
 */
export function withLessons(
  attemptDirectory: string,
  runtime: Pick<Runtime, 'name' | 'loadsExtraSkills'>,
  lessons: LessonBlock | null,
  skills: AttemptSkills,
): AttemptSkills {
  if (lessons === null) return skills;
  if (!runtime.loadsExtraSkills) {
    const noun = lessons.lessons === 1 ? 'lesson' : 'lessons';
    return {
      ...skills,
      warnings: [
        ...skills.warnings,
        `lessons are not supported by runtime ${runtime.name}: ${lessons.lessons} ${noun} skipped`,
      ],
    };
  }
  const root = join(attemptDirectory, 'skills');
  const directory = join(root, '.claude', 'skills', LESSON_SKILL_NAME);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), lessonsSkill(lessons), { mode: 0o600 });
  return { directory: skills.directory ?? root, warnings: skills.warnings, lessons: true };
}
