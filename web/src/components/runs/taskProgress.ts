/** Done and total checkboxes of a Markdown task list; null when the text has none. */
export function taskProgress(text: string): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  for (const line of text.split('\n')) {
    const match = /^\s*[-*+]\s+\[( |x|X)\]\s/.exec(line);
    if (!match) continue;
    total += 1;
    if (match[1] !== ' ') done += 1;
  }
  return total === 0 ? null : { done, total };
}
