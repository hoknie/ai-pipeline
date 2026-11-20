import type { QuestionData } from './events.ts';

/** The answers collected so far, one slot per question; null: not answered yet. */
export type Drafts = readonly (string | null)[];

export function emptyDrafts(count: number): Drafts {
  return Array.from({ length: count }, () => null);
}

/** The drafts of the stored answers; a slot outside the questions is dropped. */
export function draftsOf(
  count: number,
  stored: readonly { index: number; answer: string }[],
): Drafts {
  const drafts: (string | null)[] = Array.from({ length: count }, () => null);
  for (const { index, answer } of stored) if (index >= 0 && index < count) drafts[index] = answer;
  return drafts;
}

/** The choice of an option replaces the earlier answer of the question; null for a wrong number. */
export function selectOption(
  questions: readonly QuestionData[],
  drafts: Drafts,
  question: number,
  option: number,
): Drafts | null {
  const chosen = questions[question]?.options[option];
  return chosen === undefined ? null : setAnswer(drafts, question, chosen);
}

export function setAnswer(drafts: Drafts, question: number, answer: string): Drafts {
  return drafts.map((current, index) => (index === question ? answer : current));
}

/** Fills every question that has no answer yet and has a recommendation. */
export function acceptRecommendations(questions: readonly QuestionData[], drafts: Drafts): Drafts {
  return questions.map((question, index) => drafts[index] ?? question.recommendation ?? null);
}

/** The answers of every question, or null while one is missing. */
export function completeAnswers(count: number, drafts: Drafts): string[] | null {
  const answers = Array.from({ length: count }, (_unused, index) => drafts[index] ?? null);
  return answers.every((answer): answer is string => answer !== null) ? answers : null;
}

/** The numbers (from 1) of the questions without an answer. */
export function missing(count: number, drafts: Drafts): number[] {
  return Array.from({ length: count }, (_unused, index) => index)
    .filter((index) => drafts[index] === null || drafts[index] === undefined)
    .map((index) => index + 1);
}
