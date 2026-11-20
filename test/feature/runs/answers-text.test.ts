import { describe, expect, it } from 'vitest';

import { answersText } from '../../../src/feature/runs/types/index.ts';

const questions = [{ text: 'Which database?' }, { text: 'Add tests?' }, { text: 'Name' }];

describe('answersText', () => {
  it('writes Q and A for every question with a blank line between', () => {
    expect(answersText(questions.slice(0, 2), ['PostgreSQL', ' yes '])).toBe(
      'Q1: Which database?\nA1: PostgreSQL\n\nQ2: Add tests?\nA2: yes',
    );
  });

  it('leaves the answer of a missing index empty', () => {
    expect(answersText(questions.slice(0, 1), [])).toBe('Q1: Which database?\nA1: ');
  });
});
