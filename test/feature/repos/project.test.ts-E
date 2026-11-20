import { describe, expect, it } from 'vitest';

import {
  PROJECT_COLORS,
  checkColor,
  checkName,
  checkSlug,
  freeSlug,
  isProjectSlug,
  projectLabel,
  slugOf,
} from '../../../src/feature/repos/types/index.ts';
import { TAG_COLORS } from '../../../src/feature/tags/types/tags.ts';

describe('project slug', () => {
  it('comes from the directory name', () => {
    expect(slugOf('My Shop.API')).toBe('my-shop-api');
    expect(slugOf('--app--')).toBe('app');
    expect(slugOf('Проект')).toBe('project');
    expect(slugOf('')).toBe('project');
    expect(slugOf('a'.repeat(50))).toHaveLength(40);
    expect(slugOf(`${'a'.repeat(39)}-b`)).toBe('a'.repeat(39));
  });

  it('takes the smallest free suffix', () => {
    expect(freeSlug('app', new Set())).toBe('app');
    expect(freeSlug('app', new Set(['app']))).toBe('app-2');
    expect(freeSlug('app', new Set(['app', 'app-2']))).toBe('app-3');
    const long = 'a'.repeat(40);
    expect(freeSlug(long, new Set([long]))).toBe(`${'a'.repeat(38)}-2`);
  });

  it('accepts only the slug pattern', () => {
    expect(isProjectSlug('app-2')).toBe(true);
    expect(isProjectSlug('/work/app')).toBe(false);
    expect(isProjectSlug('-app')).toBe(false);
    expect(isProjectSlug('App')).toBe(false);
    expect(isProjectSlug('a'.repeat(41))).toBe(false);
    expect(() => checkSlug('Shop')).toThrow(/project slug `Shop`/);
  });
});

describe('project attributes', () => {
  it('trims the name, refuses an empty or long one and shows the directory without one', () => {
    expect(checkName('  Shop ')).toBe('Shop');
    expect(checkName(null)).toBeNull();
    expect(() => checkName('  ')).toThrow(/1–80/);
    expect(() => checkName('x'.repeat(81))).toThrow(/1–80/);
    expect(projectLabel({ path: '/work/shop-api', name: null })).toBe('shop-api');
    expect(projectLabel({ path: '/work/shop-api', name: 'Shop' })).toBe('Shop');
  });

  it('takes the colors of the tag palette without the reserved one', () => {
    expect([...PROJECT_COLORS]).toEqual([...TAG_COLORS]);
    expect(checkColor('teal')).toBe('teal');
    expect(checkColor(null)).toBeNull();
    expect(() => checkColor('indigo')).toThrow(/known: gray, red/);
  });
});
