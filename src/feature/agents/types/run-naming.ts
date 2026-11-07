import { RUN_NAME_LIMIT, RUN_NAME_PATTERN, RUN_TITLE_LIMIT } from './naming.ts';
import type { TranscriptEntry } from './transcript.ts';

/** The title and the name a cheap model gave a run. */
export interface RunNaming {
  title: string;
  name: string;
}

/** Cuts a title to the limit at a word boundary, with an ellipsis. */
function fitTitle(title: string): string {
  const text = title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。]+$/, '');
  if (text.length <= RUN_TITLE_LIMIT) return text;
  const cut = text.slice(0, RUN_TITLE_LIMIT - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > RUN_TITLE_LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[\s,.:;—-]+$/, '')}…`;
}

/** Lowercase kebab-case within the limit, cut at a hyphen. */
function fitName(name: string): string {
  let text = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (text.length > RUN_NAME_LIMIT) {
    const cut = text.slice(0, RUN_NAME_LIMIT + 1);
    const hyphen = cut.lastIndexOf('-');
    text = (hyphen > 0 ? cut.slice(0, hyphen) : cut.slice(0, RUN_NAME_LIMIT)).replace(/-+$/, '');
  }
  return text;
}

/** The answer of the model brought to the limits; null when nothing usable is left. */
export function fitNaming(answer: RunNaming): RunNaming | null {
  const title = fitTitle(answer.title);
  const name = fitName(answer.name);
  if (title === '' || !RUN_NAME_PATTERN.test(name)) return null;
  return { title, name };
}

/** The JSON object in an answer, or undefined when there is none. */
export function firstJsonObject(answer: string): unknown {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(answer.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

const TASK_LIMIT = 4000;

export function namingPrompt(task: string): string {
  return [
    'Name a task for a list of tasks. Answer with one JSON object and nothing else:',
    `{"title": "...", "name": "..."}`,
    `- title: the gist of the task in the language of the task, strictly at most ${RUN_TITLE_LIMIT} characters (shorter is better), no trailing period;`,
    `- name: an English kebab-case name of at most ${RUN_NAME_LIMIT} characters (lowercase latin letters, digits and hyphens), like the name of a change: add-version-json-flag, fix-login-redirect.`,
    'Task:',
    task.length > TASK_LIMIT ? `${task.slice(0, TASK_LIMIT)}…` : task,
  ].join('\n');
}

/** The answer text of a one-shot call: its result, or the text it printed. */
export function answerText(entries: TranscriptEntry[]): string {
  const result = entries.findLast((entry) => entry.kind === 'result');
  if (result?.kind === 'result' && result.text) return result.text;
  return entries.flatMap((entry) => (entry.kind === 'text' ? [entry.text] : [])).join('\n');
}
