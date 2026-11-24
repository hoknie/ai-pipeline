import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The lessons of one specialist of one repository, as the file keeps them. */
export interface LessonFile {
  repository: string;
  specialist: string;
  /** Grows by one whenever the content changes; the first file is version 1. */
  version: number;
  /** When the file was written (ms). */
  generatedAt: number;
  /** The whole lesson block of the prompt, without the header of the skill. */
  text: string;
}

/**
 * Lessons as files: `<root>/<hash of the repository>/<specialist>.md`. The file is the artifact a
 * person reads; the prompt is built from the same block the file keeps.
 */
export class LessonStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  read(repository: string, specialist: string): LessonFile | null {
    let content: string;
    try {
      content = readFileSync(this.pathOf(repository, specialist), 'utf8');
    } catch {
      return null;
    }
    return parseLessonFile(content);
  }

  write(file: LessonFile): void {
    const path = this.pathOf(file.repository, file.specialist);
    mkdirSync(join(this.root, repositoryKey(file.repository)), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, formatLessonFile(file), { mode: 0o600 });
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

function formatLessonFile(file: LessonFile): string {
  return [
    '---',
    `specialist: ${file.specialist}`,
    `repository: ${file.repository}`,
    `version: ${file.version}`,
    `generatedAt: ${file.generatedAt}`,
    '---',
    '',
    file.text,
    '',
  ].join('\n');
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/;

function parseLessonFile(content: string): LessonFile | null {
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
  if (
    specialist === undefined ||
    repository === undefined ||
    !Number.isInteger(version) ||
    !Number.isFinite(generatedAt)
  ) {
    return null;
  }
  return { repository, specialist, version, generatedAt, text: match[2]!.trimEnd() };
}
