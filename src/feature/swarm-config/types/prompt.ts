/**
 * The prompt of a specialist with the task in place of `%s`, then `additional` (the text of the
 * step) as its own paragraph, taken literally.
 */
export function buildPrompt(
  prompt: string | null,
  task: string,
  additional: string | null = null,
): string {
  const base = substitute(prompt, task);
  const extra = additional?.trim();
  return extra ? `${base.trimEnd()}\n\n${extra}` : base;
}

function substitute(prompt: string | null, task: string): string {
  if (prompt === null) return task;
  let output = '';
  let substituted = false;
  for (let index = 0; index < prompt.length; index += 1) {
    const character = prompt[index];
    const next = prompt[index + 1];
    if (character === '%' && next === '%') {
      output += '%';
      index += 1;
    } else if (character === '%' && next === 's') {
      output += task;
      substituted = true;
      index += 1;
    } else {
      output += character;
    }
  }
  return substituted ? output : `${output.trimEnd()}\n\n${task}`;
}
