import { fence } from './htmlToMarkdown.ts';

export type MarkupAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'link'
  | 'heading'
  | 'bulletList'
  | 'numberedList'
  | 'taskList'
  | 'quote'
  | 'codeBlock';

/** One replacement of the range [from, to) of the text, and the selection after it. */
export interface MarkupEdit {
  from: number;
  to: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

const WRAPPERS = { bold: '**', italic: '_', strike: '~~', code: '`' } as const;
const HEADING = '## ';

/** Edit that applies (or takes off) the markup of the button to the selection. */
export function applyMarkup(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: MarkupAction,
): MarkupEdit {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, value.length));
  const end = Math.min(value.length, Math.max(selectionStart, selectionEnd));
  switch (action) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'code':
      return wrapInline(value, start, end, WRAPPERS[action]);
    case 'link':
      return link(value, start, end);
    case 'codeBlock':
      return fenceLines(value, start, end);
    default:
      return prefixLines(value, start, end, action);
  }
}

function wrapInline(value: string, from: number, to: number, marker: string): MarkupEdit {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(value[start]!)) start++;
  while (end > start && /\s/.test(value[end - 1]!)) end--;
  if (start === end) {
    start = end = from;
  }
  const selected = value.slice(start, end);
  const m = marker.length;
  const single = marker === '`';
  if (single) {
    const unwrapped = unwrapCode(value, start, end, selected);
    if (unwrapped !== null) return unwrapped;
  }
  // the markers are right outside the selection
  if (
    !single &&
    start >= m &&
    value.startsWith(marker, start - m) &&
    value.startsWith(marker, end)
  ) {
    return {
      from: start - m,
      to: end + m,
      text: selected,
      selectionStart: start - m,
      selectionEnd: start - m + selected.length,
    };
  }
  // the markers are the edges of the selection
  if (
    selected.length > 2 * m &&
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    !(single && (selected[m] === '`' || selected[selected.length - m - 1] === '`'))
  ) {
    const inner = selected.slice(m, selected.length - m);
    return {
      from: start,
      to: end,
      text: inner,
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }
  const ticks = single ? fence(selected, 1) : marker;
  const pad = single && (selected.startsWith('`') || selected.endsWith('`')) ? ' ' : '';
  const text = `${ticks}${pad}${selected}${pad}${ticks}`;
  const open = start + ticks.length + pad.length;
  return { from: start, to: end, text, selectionStart: open, selectionEnd: open + selected.length };
}

/** Takes off a code span fence of any length (with the padding space) around the selection. */
function unwrapCode(
  value: string,
  start: number,
  end: number,
  selected: string,
): MarkupEdit | null {
  for (const pad of [0, 1]) {
    const openEnd = start - pad;
    const closeStart = end + pad;
    if (openEnd < 0) continue;
    if (pad === 1 && (value[openEnd] !== ' ' || value[end] !== ' ')) continue;
    let n = 0;
    while (openEnd - n - 1 >= 0 && value[openEnd - n - 1] === '`') n++;
    if (n === 0) continue;
    const ticks = '`'.repeat(n);
    if (!value.startsWith(ticks, closeStart) || value[closeStart + n] === '`') continue;
    return {
      from: openEnd - n,
      to: closeStart + n,
      text: selected,
      selectionStart: openEnd - n,
      selectionEnd: openEnd - n + selected.length,
    };
  }
  return null;
}

function link(value: string, start: number, end: number): MarkupEdit {
  const selected = value.slice(start, end);
  if (selected === '') {
    return {
      from: start,
      to: end,
      text: '[](url)',
      selectionStart: start + 1,
      selectionEnd: start + 1,
    };
  }
  const urlStart = start + selected.length + 3;
  return {
    from: start,
    to: end,
    text: `[${selected}](url)`,
    selectionStart: urlStart,
    selectionEnd: urlStart + 3,
  };
}

/** Whole lines touched by the selection. */
function lineRange(value: string, start: number, end: number): { from: number; to: number } {
  const from = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const found = value.indexOf('\n', last);
  return { from, to: found === -1 ? value.length : found };
}

type Kind = 'task' | 'bullet' | 'numbered';

const LIST = /^(?:([-*+])[ \t]+(\[[ xX]\][ \t]+)?|(\d+[.)])[ \t]+)/;
const QUOTE = /^>[ \t]?/;
const HEADING_PREFIX = /^#{1,6}[ \t]+/;

function listKind(rest: string): { kind: Kind; length: number } | null {
  const match = LIST.exec(rest);
  if (match === null) return null;
  const kind: Kind =
    match[3] !== undefined ? 'numbered' : match[2] !== undefined ? 'task' : 'bullet';
  return { kind, length: match[0].length };
}

function existingPrefix(rest: string, action: MarkupAction): number {
  if (action === 'heading') return HEADING_PREFIX.exec(rest)?.[0].length ?? 0;
  if (action === 'quote') return QUOTE.exec(rest)?.[0].length ?? 0;
  return listKind(rest)?.length ?? 0;
}

function matches(rest: string, action: MarkupAction): boolean {
  switch (action) {
    case 'heading':
      return rest.startsWith(HEADING) && !rest.startsWith('###');
    case 'quote':
      return QUOTE.test(rest);
    case 'bulletList':
      return listKind(rest)?.kind === 'bullet';
    case 'taskList':
      return listKind(rest)?.kind === 'task';
    default:
      return listKind(rest)?.kind === 'numbered';
  }
}

function marker(action: MarkupAction, number: number): string {
  switch (action) {
    case 'heading':
      return HEADING;
    case 'quote':
      return '> ';
    case 'bulletList':
      return '- ';
    case 'taskList':
      return '- [ ] ';
    default:
      return `${number}. `;
  }
}

interface LineChange {
  oldStart: number;
  newStart: number;
  indent: number;
  oldPrefix: number;
  newPrefix: number;
  oldLength: number;
}

function prefixLines(value: string, start: number, end: number, action: MarkupAction): MarkupEdit {
  const range = lineRange(value, start, end);
  const lines = value.slice(range.from, range.to).split('\n');
  const parts = lines.map((line) => {
    const indent = /^[ \t]*/.exec(line)![0].length;
    return { indent, rest: line.slice(indent), blank: line.trim() === '' };
  });
  const filled = parts.filter((part) => !part.blank);
  // a lone empty line still gets a marker
  const targets = filled.length > 0 ? filled : parts;
  const remove = filled.length > 0 && filled.every((part) => matches(part.rest, action));
  const changes: LineChange[] = [];
  const out: string[] = [];
  let oldStart = range.from;
  let newStart = range.from;
  let number = 1;
  parts.forEach((part, index) => {
    const line = lines[index]!;
    let oldPrefix = 0;
    let newPrefix = 0;
    let text = line;
    if (targets.includes(part)) {
      oldPrefix = existingPrefix(part.rest, action);
      const added = remove ? '' : marker(action, number++);
      newPrefix = added.length;
      text = line.slice(0, part.indent) + added + part.rest.slice(oldPrefix);
    }
    changes.push({
      oldStart,
      newStart,
      indent: part.indent,
      oldPrefix,
      newPrefix,
      oldLength: line.length,
    });
    out.push(text);
    oldStart += line.length + 1;
    newStart += text.length + 1;
  });
  const collapsed = start === end;
  const map = (position: number, afterMarker: boolean): number => {
    const change =
      changes.find((candidate) => position <= candidate.oldStart + candidate.oldLength) ??
      changes[changes.length - 1]!;
    const column = position - change.oldStart;
    if (column === change.indent && afterMarker) {
      return change.newStart + change.indent + change.newPrefix;
    }
    if (column <= change.indent) return change.newStart + Math.max(column, 0);
    if (column < change.indent + change.oldPrefix) {
      return change.newStart + change.indent + change.newPrefix;
    }
    return change.newStart + column + change.newPrefix - change.oldPrefix;
  };
  return {
    from: range.from,
    to: range.to,
    text: out.join('\n'),
    selectionStart: map(start, collapsed),
    selectionEnd: map(end, collapsed),
  };
}

function fenceLines(value: string, start: number, end: number): MarkupEdit {
  const range = lineRange(value, start, end);
  const body = value.slice(range.from, range.to);
  if (body.trim() === '') {
    const ticks = '```';
    const at = range.from + ticks.length + 1;
    return {
      from: range.from,
      to: range.to,
      text: `${ticks}\n\n${ticks}`,
      selectionStart: at,
      selectionEnd: at,
    };
  }
  const ticks = fence(body, 3);
  const open = range.from + ticks.length + 1;
  return {
    from: range.from,
    to: range.to,
    text: `${ticks}\n${body}\n${ticks}`,
    selectionStart: open,
    selectionEnd: open + body.length,
  };
}
