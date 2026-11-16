import { describe, expect, it } from 'vitest';

import { answerText, questionKey } from '../src/shared/lib/format.ts';

describe('answerText', () => {
  it('numbers questions and answers and separates them with a blank line', () => {
    expect(answerText([{ text: 'First?' }, { text: 'Second?' }], ['yes', ' no '])).toBe(
      'Q1: First?\nA1: yes\n\nQ2: Second?\nA2: no',
    );
  });

  it('leaves the answer empty when it is missing', () => {
    expect(answerText([{ text: 'Only one?' }], [])).toBe('Q1: Only one?\nA1: ');
  });
});

describe('questionKey', () => {
  it('differs for different texts and matches for the same text', () => {
    expect(questionKey('run1/login', 0, 'OAuth?')).toBe(questionKey('run1/login', 0, 'OAuth?'));
    expect(questionKey('run1/login', 0, 'OAuth?')).not.toBe(questionKey('run1/login', 0, 'SAML?'));
    expect(questionKey('run1/login', 0, 'OAuth?')).not.toBe(questionKey('run1/login', 1, 'OAuth?'));
    expect(questionKey('run1/login', 0, 'OAuth?')).toMatch(/^run1\/login\/q0\/[0-9a-f]{8}$/);
  });
});
