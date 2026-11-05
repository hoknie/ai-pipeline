import type { HumanQuestion } from './model.ts';

/** Text version of structured questions: a numbered list with options and a recommendation. */
export function questionsText(questions: readonly HumanQuestion[]): string {
  return questions
    .map((question, index) => {
      const lines = [`${index + 1}. ${question.text.trim()}`];
      const options = question.options ?? [];
      if (options.length > 0) lines.push(`   Options: ${options.join(' | ')}`);
      if (question.recommendation) lines.push(`   Recommended: ${question.recommendation}`);
      return lines.join('\n');
    })
    .join('\n');
}

/** The question of a human review: the finished step and what its specialist reported. */
export function reviewQuestion(stepLabel: string, summary: string): string {
  return `Step \`${stepLabel}\` is done and waits for your review. Summary:\n${summary.trim()}\n\nAnswer to accept, or describe what to change.`;
}
