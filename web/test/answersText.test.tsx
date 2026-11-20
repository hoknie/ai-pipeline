import { describe, expect, it } from 'vitest';

import { answersText } from '../../src/feature/runs/types/answers/answers-text.ts';
import { answerText } from '../src/shared/lib/format.ts';

describe('the text of an answer to several questions', () => {
  it('is the same in the panel and in the daemon', () => {
    const questions = [{ text: 'Which database?' }, { text: 'Add tests?' }, { text: 'Name' }];
    const answers = ['PostgreSQL', ' no\nmultiline ', ''];
    expect(answersText(questions, answers)).toBe(answerText(questions, answers));
    expect(answersText([], [])).toBe(answerText([], []));
  });
});
