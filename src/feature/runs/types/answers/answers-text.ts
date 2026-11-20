/** A question as the answer text needs it: only its text. */
export interface AskedQuestion {
  text: string;
}

/** The answer sent to the specialist: `Q1: …` / `A1: …` for every question, a blank line between. */
export function answersText(
  questions: readonly AskedQuestion[],
  answers: readonly string[],
): string {
  return questions
    .map(
      (question, index) =>
        `Q${index + 1}: ${question.text}\nA${index + 1}: ${(answers[index] ?? '').trim()}`,
    )
    .join('\n\n');
}
