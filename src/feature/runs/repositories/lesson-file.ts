import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  LESSONS_RUN_WINDOW,
  LESSON_KINDS,
  fitLessonFile,
  formatLessonFile,
  type ArchivedLesson,
  type Lesson,
  type LessonFile,
  type LessonKind,
  type SuppressedLesson,
} from '../types/index.ts';

/**
 * Lessons as files: `<root>/<hash of the repository>/<specialist>.md`. The file is the artifact a
 * person reads and can edit; the prompt is built from the same active lessons the file keeps.
 *
 * The front matter carries the structured records (one JSON value per line, which is also valid
 * YAML) and the body the same lessons as markdown. A line a person removes from the body is kept
 * out of the active lessons from then on: the read records it in the removed section.
 */
export class LessonStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  read(repository: string, specialist: string, now: number = Date.now()): LessonFile | null {
    let content: string;
    try {
      content = readFileSync(this.pathOf(repository, specialist), 'utf8');
    } catch {
      return null;
    }
    return parseLessonFile(content, now);
  }

  write(file: LessonFile): void {
    const path = this.pathOf(file.repository, file.specialist);
    mkdirSync(join(this.root, repositoryKey(file.repository)), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, formatLessonFile(fitLessonFile(file)), { mode: 0o600 });
    renameSync(temporary, path);
  }

  remove(repository: string, specialist: string): void {
    rmSync(this.pathOf(repository, specialist), { force: true });
  }

  private pathOf(repository: string, specialist: string): string {
    return join(this.root, repositoryKey(repository), `${specialist}.md`);
  }
}

function repositoryKey(repository: string): string {
  return createHash('sha256').update(repository).digest('hex').slice(0, 16);
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;

/** A lesson line of the body: `- [id] text`, with an optional `(archived 2024-01-02)` prefix. */
const LESSON_LINE = /^-\s+(?:\([^)]*\)\s+)?\[([^\]]+)\]\s+(.*)$/;

/** The ids the body shows, by section: what a person kept, and what they removed by hand. */
interface BodyIds {
  active: string[];
  texts: Map<string, string>;
  removed: string[];
}

function parseLessonFile(content: string, now: number): LessonFile | null {
  const match = FRONT_MATTER.exec(content);
  if (match === null) return null;
  const fields = new Map<string, string>();
  for (const line of match[1]!.split('\n')) {
    const at = line.indexOf(': ');
    if (at > 0) fields.set(line.slice(0, at), line.slice(at + 2));
  }
  const specialist = fields.get('specialist');
  const repository = fields.get('repository');
  const version = Number(fields.get('version'));
  const generatedAt = Number(fields.get('generatedAt'));
  const window = Number(fields.get('window') ?? LESSONS_RUN_WINDOW);
  const lessons = parseLessons(fields.get('lessons'), parseLesson);
  const archived = parseLessons(fields.get('archived'), parseArchived);
  const suppressed = parseLessons(fields.get('suppressed'), parseSuppressed);
  if (
    specialist === undefined ||
    repository === undefined ||
    !Number.isInteger(version) ||
    !Number.isFinite(generatedAt) ||
    !Number.isFinite(window) ||
    lessons === null ||
    archived === null ||
    suppressed === null
  ) {
    return null;
  }
  const edited = applyEdits(lessons, suppressed, content.slice(match[0].length), now);
  return {
    repository,
    specialist,
    version,
    generatedAt,
    window,
    lessons: edited.lessons,
    archived,
    suppressed: edited.suppressed,
  };
}

/**
 * Honours what a person deleted from the body: an active lesson whose line is gone becomes
 * removed, a removed lesson whose line is gone comes back. The front matter stays the source of
 * the structured records, so deleting its JSON line works as well as deleting a body line.
 */
function applyEdits(
  lessons: Lesson[],
  suppressed: SuppressedLesson[],
  body: string,
  now: number,
): { lessons: Lesson[]; suppressed: SuppressedLesson[] } {
  const shown = bodyIds(body);
  // A file written before the body carried ids cannot tell an edit from an old format: keep it.
  if (hasUnmarkedLines(body)) return { lessons, suppressed };
  const activeIds = new Set(shown.active);
  const frontIds = new Set(lessons.map((lesson) => lesson.id));
  const removed = new Map(suppressed.map((lesson) => [lesson.id, lesson]));
  const original = new Set(removed.keys());
  const kept: Lesson[] = [];
  for (const lesson of lessons) {
    if (activeIds.has(lesson.id)) kept.push(lesson);
    else if (!removed.has(lesson.id)) removed.set(lesson.id, { ...lesson, suppressedAt: now });
  }
  for (const id of shown.active) {
    if (frontIds.has(id) || removed.has(id)) continue;
    const text = shown.texts.get(id) ?? '';
    removed.set(id, {
      id,
      kind: kindOf(id),
      text,
      evidence: emptyEvidence(),
      priority: 0,
      suppressedAt: now,
    });
  }
  // Deleting a line of the removed section brings a rule that was already removed there back.
  for (const id of [...removed.keys()]) {
    if (original.has(id) && !shown.removed.includes(id)) removed.delete(id);
  }
  return { lessons: kept, suppressed: [...removed.values()] };
}

function emptyEvidence(): Lesson['evidence'] {
  return { occurrences: 0, attempts: 0, tasks: [], seenAt: 0 };
}

/** The kind an id stands for: the id is `<kind>:<detail>` or one of the singleton kinds. */
function kindOf(id: string): LessonKind {
  const prefix = id.includes(':') ? id.slice(0, id.indexOf(':')) : id;
  return LESSON_KINDS.includes(prefix as LessonKind) ? (prefix as LessonKind) : 'denial';
}

function bodyIds(body: string): BodyIds {
  const archivedAt = body.indexOf('## Archived lessons');
  const removedAt = body.indexOf('## Removed lessons');
  const activeEnd = firstIndex(archivedAt, removedAt, body.length);
  const texts = new Map<string, string>();
  const active: string[] = [];
  for (const line of body.slice(0, activeEnd).split('\n')) {
    const match = LESSON_LINE.exec(line);
    if (match === null) continue;
    active.push(match[1]!);
    texts.set(match[1]!, match[2]!);
  }
  const removed: string[] = [];
  for (const line of (removedAt < 0 ? '' : body.slice(removedAt)).split('\n')) {
    const match = LESSON_LINE.exec(line);
    if (match !== null) removed.push(match[1]!);
  }
  return { active, texts, removed };
}

function firstIndex(...values: number[]): number {
  return Math.min(...values.filter((value) => value >= 0));
}

/** Whether the body has a lesson line without an id: the format of a file written before them. */
function hasUnmarkedLines(body: string): boolean {
  return body.split('\n').some((line) => /^-\s+/.test(line) && LESSON_LINE.exec(line) === null);
}

function parseLessons<T>(raw: string | undefined, parse: (value: unknown) => T | null): T[] | null {
  if (raw === undefined || raw === '') return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const parsed: T[] = [];
  for (const one of value) {
    const item = parse(one);
    if (item === null) return null;
    parsed.push(item);
  }
  return parsed;
}

function parseArchived(value: unknown): ArchivedLesson | null {
  const lesson = parseLesson(value);
  if (lesson === null) return null;
  const archivedAt = (value as { archivedAt?: unknown }).archivedAt;
  if (!Number.isFinite(archivedAt)) return null;
  return { ...lesson, archivedAt: archivedAt as number };
}

function parseSuppressed(value: unknown): SuppressedLesson | null {
  const lesson = parseLesson(value);
  if (lesson === null) return null;
  const suppressedAt = (value as { suppressedAt?: unknown }).suppressedAt;
  if (!Number.isFinite(suppressedAt)) return null;
  return { ...lesson, suppressedAt: suppressedAt as number };
}

function parseLesson(value: unknown): Lesson | null {
  if (typeof value !== 'object' || value === null) return null;
  const one = value as Record<string, unknown>;
  const evidence = one.evidence as Record<string, unknown> | undefined;
  if (
    typeof one.id !== 'string' ||
    one.id === '' ||
    !LESSON_KINDS.includes(one.kind as LessonKind) ||
    typeof one.text !== 'string' ||
    !Number.isFinite(one.priority) ||
    typeof evidence !== 'object' ||
    evidence === null ||
    !Number.isFinite(evidence.occurrences) ||
    !Number.isFinite(evidence.seenAt) ||
    !Array.isArray(evidence.tasks)
  ) {
    return null;
  }
  return {
    id: one.id,
    kind: one.kind as LessonKind,
    text: one.text,
    evidence: {
      occurrences: evidence.occurrences as number,
      // A file written before the denominator existed falls back to the count itself.
      attempts: Number.isFinite(evidence.attempts)
        ? (evidence.attempts as number)
        : (evidence.occurrences as number),
      tasks: evidence.tasks.filter((task): task is number => Number.isFinite(task)),
      seenAt: evidence.seenAt as number,
    },
    priority: one.priority as number,
  };
}
