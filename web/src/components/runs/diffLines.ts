export type DiffRowKind = 'ctx' | 'add' | 'del' | 'note';

export interface DiffRow {
  kind: DiffRowKind;
  /** Line number in the old file; null for an added line and a note. */
  old: number | null;
  /** Line number in the new file; null for a removed line and a note. */
  new: number | null;
  text: string;
}

export interface DiffHunk {
  /** The `@@ -a,b +c,d @@ …` line. */
  header: string;
  rows: DiffRow[];
}

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Splits the lines of a file diff (from the first `@@`) into hunks with line numbers. */
export function parseHunks(lines: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let hunk: DiffHunk | null = null;
  let old = 0;
  let next = 0;
  for (const line of lines) {
    const header = HEADER.exec(line);
    if (header) {
      hunk = { header: line, rows: [] };
      hunks.push(hunk);
      old = Number(header[1]);
      next = Number(header[2]);
      continue;
    }
    if (!hunk) continue;
    const text = line.slice(1);
    if (line.startsWith('+')) hunk.rows.push({ kind: 'add', old: null, new: next++, text });
    else if (line.startsWith('-')) hunk.rows.push({ kind: 'del', old: old++, new: null, text });
    else if (line.startsWith('\\'))
      hunk.rows.push({ kind: 'note', old: null, new: null, text: line });
    else hunk.rows.push({ kind: 'ctx', old: old++, new: next++, text });
  }
  return hunks;
}
