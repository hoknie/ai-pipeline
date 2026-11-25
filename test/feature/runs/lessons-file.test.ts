import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LESSON_COUNT_LIMIT,
  LESSON_FILE_LIMIT,
  LESSON_HEADER,
  selectLessons,
  type ArchivedLesson,
  type Lesson,
  type LessonFile,
} from '../../../src/feature/runs/types/index.ts';
import { LessonStorage } from '../../../src/feature/runs/repositories/index.ts';

function lesson(id: string, overrides: Partial<Lesson> = {}): Lesson {
  return {
    id,
    kind: 'denial',
    text: `Rule ${id}: do not repeat the mistake.`,
    evidence: { occurrences: 1, attempts: 1, tasks: [7], seenAt: 1_700_000_000_000 },
    priority: 10,
    ...overrides,
  };
}

function fileOf(overrides: Partial<LessonFile> = {}): LessonFile {
  return {
    repository: '/repo',
    specialist: 'coder',
    version: 2,
    generatedAt: 1_700_000_000_000,
    window: 50,
    lessons: [lesson('denial:Bash')],
    archived: [],
    suppressed: [],
    ...overrides,
  };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'aip-lessons-file-'));
}

function pathOf(root: string, repository: string, specialist: string): string {
  const key = createHash('sha256').update(repository).digest('hex').slice(0, 16);
  return join(root, key, `${specialist}.md`);
}

describe('LessonStorage', () => {
  it('writes one readable markdown file per repository and specialist', () => {
    const root = tempRoot();
    const storage = new LessonStorage(root);
    const archived: ArchivedLesson = {
      ...lesson('rejected', { text: 'A reviewer rejected the result twice.' }),
      archivedAt: 1_699_000_000_000,
    };
    storage.write(fileOf({ archived: [archived] }));

    expect(storage.read('/repo', 'coder')).toEqual(fileOf({ archived: [archived] }));
    expect(storage.read('/other', 'coder')).toBeNull();

    const content = readFileSync(pathOf(root, '/repo', 'coder'), 'utf8');
    expect(content).toContain('# Lessons from earlier runs');
    expect(content).toContain('- [denial:Bash] Rule denial:Bash: do not repeat the mistake.');
    expect(content).toContain('## Archived lessons');
    expect(content).toContain(
      '- (archived 2023-11-03) [rejected] A reviewer rejected the result twice.',
    );
  });

  it('keeps the file within the character limit by dropping the oldest archived lessons', () => {
    const root = tempRoot();
    const storage = new LessonStorage(root);
    const archived = Array.from({ length: 80 }, (_, index) => ({
      ...lesson(`denial:Tool${String(index).padStart(2, '0')}`, {
        text: `${'A rule that takes room. '.repeat(20)}${index}`,
      }),
      archivedAt: 1_700_000_000_000 - index,
    }));

    storage.write(fileOf({ archived }));
    const content = readFileSync(pathOf(root, '/repo', 'coder'), 'utf8');
    const read = storage.read('/repo', 'coder')!;

    expect(content.length).toBeLessThanOrEqual(LESSON_FILE_LIMIT);
    expect(read.archived.length).toBeGreaterThan(0);
    expect(read.archived.length).toBeLessThan(archived.length);
    // The oldest leave first: the newest stays.
    expect(read.archived[0]!.id).toBe(archived[0]!.id);

    storage.write(fileOf({ archived }));
    expect(readFileSync(pathOf(root, '/repo', 'coder'), 'utf8')).toBe(content);
  });

  it('keeps the file within the character limit even without an archive', () => {
    const root = tempRoot();
    const storage = new LessonStorage(root);
    const lessons = Array.from({ length: LESSON_COUNT_LIMIT }, (_, index) =>
      lesson(`denial:Tool${String(index).padStart(2, '0')}`, {
        text: `${'A rule that takes room. '.repeat(40)}${index}`,
      }),
    );

    storage.write(fileOf({ lessons, archived: [] }));
    const content = readFileSync(pathOf(root, '/repo', 'coder'), 'utf8');
    const read = storage.read('/repo', 'coder')!;

    expect(content.length).toBeLessThanOrEqual(LESSON_FILE_LIMIT);
    expect(read.lessons.length).toBeGreaterThan(0);
    expect(read.lessons.length).toBeLessThan(lessons.length);
    // The least important tail leaves first: the head of the list stays whole.
    expect(read.lessons.map((one) => one.id)).toEqual(
      lessons.slice(0, read.lessons.length).map((one) => one.id),
    );
  });

  it('keeps a rule a person deleted from the body out of the active lessons', () => {
    const root = tempRoot();
    const storage = new LessonStorage(root);
    const kept = lesson('denial:Bash');
    const removed = lesson('rejected', { text: 'A reviewer rejected the result twice.' });
    storage.write(fileOf({ lessons: [kept, removed] }));

    const path = pathOf(root, '/repo', 'coder');
    const edited = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => !line.includes(`[${removed.id}]`))
      .join('\n');
    writeFileSync(path, edited);

    const read = storage.read('/repo', 'coder', 6000)!;
    expect(read.lessons.map((one) => one.id)).toEqual(['denial:Bash']);
    expect(read.suppressed.map((one) => one.id)).toEqual(['rejected']);
    expect(read.suppressed[0]!.suppressedAt).toBe(6000);

    // The removal survives a rewrite: the rule stays in the removed section, not in attempts.
    storage.write(read);
    const again = storage.read('/repo', 'coder', 7000)!;
    expect(again.lessons.map((one) => one.id)).toEqual(['denial:Bash']);
    expect(again.suppressed.map((one) => one.id)).toEqual(['rejected']);
    expect(readFileSync(path, 'utf8')).toContain('## Removed lessons');
  });

  it('ignores a file it cannot read instead of failing an attempt', () => {
    const root = tempRoot();
    const storage = new LessonStorage(root);
    const path = pathOf(root, '/repo', 'coder');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '---\nspecialist: coder\nrepository: /repo\nversion: nope\n---\n');

    expect(storage.read('/repo', 'coder')).toBeNull();
  });
});

describe('selectLessons', () => {
  it('never exceeds the count limit and orders the same candidates identically', () => {
    const candidates = Array.from({ length: LESSON_COUNT_LIMIT + 10 }, (_, index) =>
      lesson(`denial:Tool${String(index).padStart(2, '0')}`, {
        // Every other rule has more evidence: the order must follow it, not the input order.
        evidence: { occurrences: 1 + (index % 3), attempts: 5, tasks: [index], seenAt: 1 },
      }),
    );

    const forward = selectLessons(candidates, null, 5000);
    const backward = selectLessons([...candidates].reverse(), null, 5000);

    expect(forward.lessons.length).toBe(LESSON_COUNT_LIMIT);
    expect(backward.lessons.map((one) => one.id)).toEqual(forward.lessons.map((one) => one.id));
    expect(forward.dropped).toBe(candidates.length - LESSON_COUNT_LIMIT);
  });

  it('moves a gone pattern to the archive and resurrects it when it returns', () => {
    const previous = {
      lessons: [lesson('outside_changes', { priority: 13 }), lesson('denial:Bash')],
      archived: [],
    };

    const gone = selectLessons([], previous, 5000);
    expect(gone.lessons).toEqual([]);
    expect(gone.archived.map((one) => one.id)).toEqual(['outside_changes', 'denial:Bash']);
    expect(gone.archived.every((one) => one.archivedAt === 5000)).toBe(true);

    const back = selectLessons([lesson('denial:Bash')], gone, 6000);
    expect(back.lessons.map((one) => one.id)).toEqual(['denial:Bash']);
    expect(back.archived.map((one) => one.id)).toEqual(['outside_changes']);

    const again = selectLessons([lesson('denial:Bash')], back, 7000);
    expect(again.archived).toEqual(back.archived);
  });

  it('keeps a returning archived lesson in the archive while the active list is full', () => {
    const older = { ...lesson('denial:Old', { priority: 1 }), archivedAt: 4000 };
    const many = Array.from({ length: LESSON_COUNT_LIMIT + 2 }, (_, index) =>
      lesson(`denial:New${String(index).padStart(2, '0')}`, { priority: 100 - index }),
    );

    const selected = selectLessons(
      [...many, lesson('denial:Old', { priority: 1 })],
      { lessons: [], archived: [older] },
      6000,
    );

    expect(selected.lessons.some((one) => one.id === 'denial:Old')).toBe(false);
    expect(selected.archived.map((one) => one.id)).toEqual(['denial:Old']);
    expect(selected.archived[0]!.archivedAt).toBe(4000);
  });

  it('never activates a lesson a person removed by hand', () => {
    const removed = lesson('denial:Bash');
    const source = {
      lessons: [removed],
      archived: [],
      suppressed: [{ ...removed, suppressedAt: 5000 }],
    };

    const selected = selectLessons(
      [lesson('denial:Bash'), lesson('rejected', { priority: 50 })],
      source,
      6000,
    );

    expect(selected.lessons.map((one) => one.id)).toEqual(['rejected']);
    expect(selected.suppressed.map((one) => one.id)).toEqual(['denial:Bash']);
  });

  it('keeps the header out of the block when no candidate fits', () => {
    const huge = lesson('denial:Bash', { text: 'x'.repeat(10_000) });
    const selected = selectLessons([huge], null, 5000, LESSON_HEADER.length + 10);
    expect(selected.lessons).toEqual([]);
    expect(selected.text).toBe('');
    expect(selected.dropped).toBe(1);
  });
});
