export type TextAnswer = { ok: true; answers: { index: number; text: string }[] } | { ok: false };

const NUMBERED = /^\s*(\d{1,3})\s*[:.]\s*(.*)$/;

/**
 * Reads a text answer to `count` questions. `N: text` and `N. text` answer question N and the
 * lines that follow without a number continue it. With one question or none (a question without
 * structure, a review) the whole text is the answer; a leading `1:` of a single question is dropped.
 */
export function parseTextAnswer(text: string, count: number): TextAnswer {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false };
  if (count <= 1) {
    const single = NUMBERED.exec(trimmed);
    const body = count === 1 && single && Number(single[1]) === 1 ? single[2]!.trim() : trimmed;
    return body === '' ? { ok: false } : { ok: true, answers: [{ index: 0, text: body }] };
  }
  const found = new Map<number, string[]>();
  let current: string[] | null = null;
  for (const line of trimmed.split('\n')) {
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      const number = Number(numbered[1]);
      if (number < 1 || number > count) return { ok: false };
      current = found.get(number - 1) ?? [];
      found.set(number - 1, current);
      current.push(numbered[2]!);
    } else if (current === null) {
      return { ok: false };
    } else {
      current.push(line);
    }
  }
  const answers = [...found]
    .map(([index, lines]) => ({ index, text: lines.join('\n').trim() }))
    .sort((a, b) => a.index - b.index);
  return answers.length === 0 || answers.some((answer) => answer.text === '')
    ? { ok: false }
    : { ok: true, answers };
}
