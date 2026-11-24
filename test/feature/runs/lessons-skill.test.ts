import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import type { Runtime } from '../../../src/feature/agents/types/index.ts';
import { LESSON_SKILL_NAME, type LessonBlock } from '../../../src/feature/runs/types/index.ts';
import {
  LESSONS_SKILL_HEADER,
  lessonsSkill,
  withLessons,
} from '../../../src/feature/runs/services/effects/skills/lessons.ts';

const BLOCK: LessonBlock = {
  text: '# Lessons from earlier runs\n\n- A whole lesson with its evidence.',
  lessons: 1,
  dropped: 0,
};

const CLAUDE: Pick<Runtime, 'name' | 'loadsExtraSkills'> = {
  name: 'claude',
  loadsExtraSkills: true,
};
const OPENCODE: Pick<Runtime, 'name' | 'loadsExtraSkills'> = {
  name: 'opencode',
  loadsExtraSkills: false,
};

function attemptDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'aip-skills-'));
}

describe('lessonsSkill', () => {
  it('puts a fixed head before the capped block', () => {
    const text = lessonsSkill(BLOCK);
    expect(text.startsWith(LESSONS_SKILL_HEADER)).toBe(true);
    expect(text).toContain(`name: ${LESSON_SKILL_NAME}`);
    expect(text).toContain(BLOCK.text);
  });

  it('keeps the head valid YAML with the skill name and a description', () => {
    const frontMatter = lessonsSkill(BLOCK).split(/^---$/m)[1];
    expect(frontMatter).toBeDefined();
    const fields = parseYaml(frontMatter!) as Record<string, unknown>;
    expect(fields.name).toBe(LESSON_SKILL_NAME);
    expect(typeof fields.description).toBe('string');
    expect((fields.description as string).length).toBeGreaterThan(0);
  });
});

describe('withLessons', () => {
  it('changes nothing for an attempt without lessons', () => {
    const skills = { directory: '/tmp/skills', warnings: ['one'] };
    expect(withLessons(attemptDirectory(), CLAUDE, null, skills)).toBe(skills);
  });

  it('writes the skill of a runtime that loads extra skills', () => {
    const directory = attemptDirectory();
    const skills = withLessons(directory, CLAUDE, BLOCK, { directory: null, warnings: [] });
    expect(skills.directory).toBe(join(directory, 'skills'));
    expect(skills.warnings).toEqual([]);
    expect(skills.lessons).toBe(true);
    const file = readFileSync(
      join(directory, 'skills', '.claude', 'skills', LESSON_SKILL_NAME, 'SKILL.md'),
      'utf8',
    );
    expect(file).toContain(LESSON_SKILL_NAME);
    expect(file).toContain(BLOCK.text);
  });

  it('keeps the folder of the registry skills and warns instead of writing for another runtime', () => {
    const directory = attemptDirectory();
    const registry = join(directory, 'skills');
    const kept = withLessons(directory, CLAUDE, BLOCK, {
      directory: registry,
      warnings: ['kept'],
    });
    expect(kept).toEqual({ directory: registry, warnings: ['kept'], lessons: true });
    // The lesson file lives in the same folder the registry skills were laid out in.
    const file = readFileSync(
      join(registry, '.claude', 'skills', LESSON_SKILL_NAME, 'SKILL.md'),
      'utf8',
    );
    expect(file).toContain(BLOCK.text);

    const warned = withLessons(directory, OPENCODE, BLOCK, { directory: null, warnings: [] });
    expect(warned).toEqual({
      directory: null,
      warnings: [`lessons are not supported by runtime opencode: 1 lesson skipped`],
    });
  });
});
