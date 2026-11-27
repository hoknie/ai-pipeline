// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { isSafeLink } from '../src/shared/lib/markdown/linkEditing.ts';

it.each([
  'docs/guide.md',
  '../guide.md',
  './x',
  '/x',
  '#x',
  '?a=b',
  'https://example.com',
  'mailto:a@b.test',
])('allows safe destination %s', (href) => expect(isSafeLink(href)).toBe(true));
it.each([
  'javascript:alert(1)',
  'data:text/html,bad',
  'vbscript:x',
  'java\nscript:x',
  '\u0000https://x',
  'file:///x',
  '',
])('rejects dangerous destination %j', (href) => expect(isSafeLink(href)).toBe(false));
