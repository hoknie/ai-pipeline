import { describe, expect, it } from 'vitest';

import {
  CHAIN_TAG_COLOR,
  Rejection,
  TAG_COLORS,
  addLinkedTag,
  addTag,
  autoTagName,
  editTag,
  keepLinkedTags,
  knownTags,
  mergeTags,
  removeTag,
  resolveManualTags,
  resolveTags,
  type Tag,
} from '../../src/core/index.ts';

function catalogOf(...names: string[]): Tag[] {
  const catalog: Tag[] = [];
  names.forEach((name, index) => catalog.push(addTag(catalog, { name }, `tg-${index}`, index)));
  return catalog;
}

describe('tag catalog', () => {
  it('has a palette of ten colors', () => {
    expect(TAG_COLORS).toHaveLength(10);
  });

  it('rejects a name longer than 30 characters, empty or with a line break', () => {
    expect(() => addTag([], { name: 'x'.repeat(31) }, 'a', 1)).toThrow(Rejection);
    expect(addTag([], { name: 'x'.repeat(30) }, 'a', 1).name).toHaveLength(30);
    expect(() => addTag([], { name: '  ' }, 'a', 1)).toThrow(Rejection);
    expect(() => addTag([], { name: 'a\nb' }, 'a', 1)).toThrow(Rejection);
  });

  it('trims the name', () => {
    expect(addTag([], { name: '  auth ' }, 'a', 1).name).toBe('auth');
  });

  it('rejects a repeated name in another case, Cyrillic included', () => {
    const catalog = catalogOf('auth', 'Вход');
    expect(() => addTag(catalog, { name: ' AUTH ' }, 'x', 1)).toThrow('tag `auth` already exists');
    expect(() => addTag(catalog, { name: 'вход' }, 'x', 1)).toThrow('tag `Вход` already exists');
  });

  it('rejects an unknown color and lists the palette', () => {
    expect(() => addTag([], { name: 'a', color: '#ff0000' }, 'x', 1)).toThrow(
      `known: ${TAG_COLORS.join(', ')}`,
    );
  });

  it('takes the default color from the palette by the size of the catalog', () => {
    const catalog = catalogOf('a', 'b');
    expect(addTag(catalog, { name: 'c' }, 'x', 1).color).toBe('orange');
    expect(addTag(catalog, { name: 'c', color: 'pink' }, 'x', 1).color).toBe('pink');
  });

  it('wraps the default color around the palette', () => {
    const catalog = catalogOf(...Array.from({ length: 10 }, (_, index) => `t${index}`));
    expect(addTag(catalog, { name: 'next' }, 'x', 1).color).toBe('gray');
  });

  it('allows a rename that only changes the case, and keeps the id', () => {
    const catalog = catalogOf('auth');
    const edited = editTag(catalog, 'auth', { name: 'Auth' });
    expect(edited).toMatchObject({ id: 'tg-0', name: 'Auth' });
  });

  it('rejects a rename to another tag, and an edit without changes', () => {
    const catalog = catalogOf('auth', 'v2');
    expect(() => editTag(catalog, 'v2', { name: 'AUTH' })).toThrow('already exists');
    expect(() => editTag(catalog, 'v2', {})).toThrow(Rejection);
    expect(editTag(catalog, 'V2', { color: 'teal' }).color).toBe('teal');
  });

  it('finds the tag to remove by name', () => {
    expect(removeTag(catalogOf('auth'), ' AUTH ').id).toBe('tg-0');
    expect(() => removeTag(catalogOf('auth'), 'nope')).toThrow('unknown tag `nope`');
  });
});

describe('resolveTags', () => {
  const catalog = catalogOf('auth', 'v2');

  it('maps names to ids ignoring case', () => {
    expect(resolveTags(catalog, ['V2', ' auth'])).toEqual(['tg-1', 'tg-0']);
  });

  it('merges repeats and keeps the first appearance', () => {
    expect(resolveTags(catalog, ['auth', 'AUTH', 'v2', 'auth'])).toEqual(['tg-0', 'tg-1']);
  });

  it('rejects the whole list on an unknown name with a hint', () => {
    expect(() => resolveTags(catalog, ['auth', 'nope'])).toThrow(
      'unknown tag `nope`; create it with `aip tag add nope`',
    );
  });
});

describe('knownTags', () => {
  it('drops ids that are not in the catalog and keeps the order', () => {
    expect(knownTags(catalogOf('a', 'b'), ['tg-1', 'gone', 'tg-0'])).toEqual(['tg-1', 'tg-0']);
  });
});

describe('mergeTags', () => {
  it('joins lists without repeats in the order of first appearance', () => {
    expect(mergeTags(['a', 'b'], ['b', 'c'], [], ['a', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    expect(mergeTags()).toEqual([]);
  });
});

describe('autoTagName', () => {
  it('keeps a short name', () => {
    expect(autoTagName([], 'fix-login')).toBe('fix-login');
  });

  it('cuts a long name at the last whole word', () => {
    const name = autoTagName([], 'archive-queue-usage-limit-guard-change');
    expect(name).toBe('archive-queue-usage-limit');
  });

  it('cuts a word longer than the limit hard', () => {
    const name = autoTagName([], 'a'.repeat(45));
    expect(name).toBe('a'.repeat(30));
  });

  it('adds a suffix while the name is taken, ignoring case', () => {
    expect(autoTagName(catalogOf('Fix-Login'), 'fix-login')).toBe('fix-login-2');
    expect(autoTagName(catalogOf('Fix-Login', 'fix-login-2'), 'fix-login')).toBe('fix-login-3');
  });

  it('keeps the name with a suffix within the limit', () => {
    const base = 'a'.repeat(30);
    const name = autoTagName(catalogOf(base), base);
    expect(name).toBe(`${'a'.repeat(28)}-2`);
    expect([...name].length).toBeLessThanOrEqual(30);
  });
});

describe('linked task tags', () => {
  it('rejects the reserved color for ordinary tags', () => {
    expect(() => addTag([], { name: 'a', color: 'indigo' }, 'a', 1)).toThrow(
      'color `indigo` is reserved for linked task tags',
    );
    expect(() => addTag([], { name: 'a', color: 'nope' }, 'a', 1)).toThrow('unknown color');
    const catalog = catalogOf('a');
    expect(() => editTag(catalog, 'a', { color: 'indigo' })).toThrow('reserved');
    expect(catalog[0]!.task).toBeNull();
    expect(addTag(catalogOf('a', 'b'), { name: 'c' }, 'c', 1).color).toBe(TAG_COLORS[2]);
  });

  it('adds a linked tag, allows a rename but not a color change', () => {
    const linked = addLinkedTag([], { name: 'cards', task: { run: 'r1', number: 115 } }, 'l', 1);
    expect(linked).toMatchObject({ color: CHAIN_TAG_COLOR, task: { run: 'r1', number: 115 } });
    expect(() => addLinkedTag([linked], { name: 'CARDS', task: linked.task! }, 'm', 2)).toThrow(
      'already exists',
    );
    expect(() => editTag([linked], 'cards', { color: 'red' })).toThrow(
      'linked task tag color cannot be changed',
    );
    expect(editTag([linked], 'cards', { name: 'cards2' })).toMatchObject({
      name: 'cards2',
      task: { run: 'r1', number: 115 },
    });
  });

  it('refuses a linked tag by hand, naming its task', () => {
    const plain = catalogOf('auth');
    const linked = addLinkedTag(plain, { name: 'cards', task: { run: 'r1', number: 7 } }, 'l', 1);
    const catalog = [...plain, linked];
    expect(resolveManualTags(catalog, ['auth'])).toEqual(['tg-0']);
    expect(() => resolveManualTags(catalog, ['auth', 'cards'])).toThrow(
      'tag `cards` belongs to task #7 and is set automatically',
    );
    expect(resolveTags(catalog, ['cards'])).toEqual(['l']);
  });

  it('keeps linked tags first in their order', () => {
    const plain = catalogOf('auth', 'v2');
    const a = addLinkedTag(plain, { name: 'a', task: { run: 'r1', number: 1 } }, 'la', 1);
    const catalog = [...plain, a];
    expect(keepLinkedTags(catalog, ['tg-0', 'la'], ['tg-1', 'tg-1', 'la'])).toEqual(['la', 'tg-1']);
    expect(keepLinkedTags(catalog, ['tg-0', 'la'], [])).toEqual(['la']);
  });
});
