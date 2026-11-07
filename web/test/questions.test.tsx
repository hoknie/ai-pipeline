import { describe, expect, it } from 'vitest';

import { answerText, questionKey } from '../src/shared/lib/format.ts';

describe('answerText', () => {
  it('numbers questions and answers and separates them with a blank line', () => {
    expect(answerText([{ text: 'Первый?' }, { text: 'Второй?' }], ['да', ' нет '])).toBe(
      'Q1: Первый?\nA1: да\n\nQ2: Второй?\nA2: нет',
    );
  });

  it('leaves the answer empty when it is missing', () => {
    expect(answerText([{ text: 'Один?' }], [])).toBe('Q1: Один?\nA1: ');
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
