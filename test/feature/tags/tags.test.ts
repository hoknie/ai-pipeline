import { describe, expect, it } from 'vitest';

import { AppError } from '../../../src/platform/errors/index.ts';
import {
  type Tag,
  CHAIN_TAG_COLOR,
  TAG_COLORS,
  addLinkedTag,
  addTag,
  autoTagName,
  tagsOfRepository,
  findTag,
  editTag,
  keepLinkedTags,
  linkedTagOf,
  parseParentRef,
  withoutLinkedTags,
  knownTags,
  mergeTags,
  removeTag,
  resolveManualTags,
  resolveTags,
} from '../../../src/feature/tags/types/index.ts';

const REPO = '/repo';

function catalogOf(...names: string[]): Tag[] {
  const catalog: Tag[] = [];
  names.forEach((name, index) =>
    catalog.push(addTag(catalog, { name, repository: REPO }, `tg-${index}`, index)),
  );
  return catalog;
}

describe('tag catalog', () => {
  it('has a palette of ten colors', () => {
    expect(TAG_COLORS).toHaveLength(10);
  });

  it('rejects a name longer than 30 characters, empty or with a line break', () => {
    expect(() => addTag([], { repository: REPO, name: 'x'.repeat(31) }, 'a', 1)).toThrow(AppError);
    expect(addTag([], { repository: REPO, name: 'x'.repeat(30) }, 'a', 1).name).toHaveLength(30);
    expect(() => addTag([], { repository: REPO, name: '  ' }, 'a', 1)).toThrow(AppError);
    expect(() => addTag([], { repository: REPO, name: 'a\nb' }, 'a', 1)).toThrow(AppError);
  });

  it('trims the name', () => {
    expect(addTag([], { repository: REPO, name: '  auth ' }, 'a', 1).name).toBe('auth');
  });

  it('rejects a repeated name in another case, Cyrillic included', () => {
    const catalog = catalogOf('auth', 'Вход');
    expect(() => addTag(catalog, { repository: REPO, name: ' AUTH ' }, 'x', 1)).toThrow(
      'tag `auth` already exists',
    );
    expect(() => addTag(catalog, { repository: REPO, name: 'вход' }, 'x', 1)).toThrow(
      'tag `Вход` already exists',
    );
  });

  it('rejects an unknown color and lists the palette', () => {
    expect(() => addTag([], { repository: REPO, name: 'a', color: '#ff0000' }, 'x', 1)).toThrow(
      `known: ${TAG_COLORS.join(', ')}`,
    );
  });

  it('takes the default color from the palette by the size of the catalog', () => {
    const catalog = catalogOf('a', 'b');
    expect(addTag(catalog, { repository: REPO, name: 'c' }, 'x', 1).color).toBe('orange');
    expect(addTag(catalog, { repository: REPO, name: 'c', color: 'pink' }, 'x', 1).color).toBe(
      'pink',
    );
  });

  it('wraps the default color around the palette', () => {
    const catalog = catalogOf(...Array.from({ length: 10 }, (_, index) => `t${index}`));
    expect(addTag(catalog, { repository: REPO, name: 'next' }, 'x', 1).color).toBe('gray');
  });

  it('allows a rename that only changes the case, and keeps the id', () => {
    const catalog = catalogOf('auth');
    const edited = editTag(catalog, 'auth', { name: 'Auth' });
    expect(edited).toMatchObject({ id: 'tg-0', name: 'Auth' });
  });

  it('rejects a rename to another tag, and an edit without changes', () => {
    const catalog = catalogOf('auth', 'v2');
    expect(() => editTag(catalog, 'v2', { name: 'AUTH' })).toThrow('already exists');
    expect(() => editTag(catalog, 'v2', {})).toThrow(AppError);
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
    expect(() => addTag([], { repository: REPO, name: 'a', color: 'indigo' }, 'a', 1)).toThrow(
      'color `indigo` is reserved for linked task tags',
    );
    expect(() => addTag([], { repository: REPO, name: 'a', color: 'nope' }, 'a', 1)).toThrow(
      'unknown color',
    );
    const catalog = catalogOf('a');
    expect(() => editTag(catalog, 'a', { color: 'indigo' })).toThrow('reserved');
    expect(catalog[0]!.task).toBeNull();
    expect(addTag(catalogOf('a', 'b'), { repository: REPO, name: 'c' }, 'c', 1).color).toBe(
      TAG_COLORS[2],
    );
  });

  it('adds a linked tag, allows a rename but not a color change', () => {
    const linked = addLinkedTag(
      [],
      { repository: REPO, name: 'cards', task: { run: 'r1', number: 115 } },
      'l',
      1,
    );
    expect(linked).toMatchObject({ color: CHAIN_TAG_COLOR, task: { run: 'r1', number: 115 } });
    expect(() =>
      addLinkedTag([linked], { repository: REPO, name: 'CARDS', task: linked.task! }, 'm', 2),
    ).toThrow('already exists');
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
    const linked = addLinkedTag(
      plain,
      { repository: REPO, name: 'cards', task: { run: 'r1', number: 7 } },
      'l',
      1,
    );
    const catalog = [...plain, linked];
    expect(resolveManualTags(catalog, ['auth'])).toEqual(['tg-0']);
    expect(() => resolveManualTags(catalog, ['auth', 'cards'])).toThrow(
      'tag `cards` belongs to task #7 and is set automatically',
    );
    expect(resolveTags(catalog, ['cards'])).toEqual(['l']);
  });

  it('keeps linked tags first in their order', () => {
    const plain = catalogOf('auth', 'v2');
    const a = addLinkedTag(
      plain,
      { repository: REPO, name: 'a', task: { run: 'r1', number: 1 } },
      'la',
      1,
    );
    const catalog = [...plain, a];
    expect(keepLinkedTags(catalog, ['tg-0', 'la'], ['tg-1', 'tg-1', 'la'])).toEqual(['la', 'tg-1']);
    expect(keepLinkedTags(catalog, ['tg-0', 'la'], [])).toEqual(['la']);
  });
});

describe('linked task tag of a run', () => {
  const linked = (catalog: Tag[], name: string, run: string, createdAt: number): Tag => {
    const tag = addLinkedTag(
      catalog,
      { repository: REPO, name, task: { run, number: 5 } },
      `lk-${name}`,
      createdAt,
    );
    return tag;
  };

  it('finds the earliest tag made for the run, also after a rename', () => {
    const catalog = catalogOf('auth');
    catalog.push(linked(catalog, 'late', 'r1', 50));
    catalog.push(linked(catalog, 'early', 'r1', 10));
    catalog.push(linked(catalog, 'other', 'r2', 1));
    expect(linkedTagOf(catalog, 'r1')?.name).toBe('early');
    expect(linkedTagOf(catalog, 'r2')?.name).toBe('other');
    expect(linkedTagOf(catalog, 'r3')).toBeUndefined();
    const renamed = catalog.map((tag) =>
      tag.name === 'early' ? { ...tag, name: 'renamed' } : tag,
    );
    expect(linkedTagOf(renamed, 'r1')?.name).toBe('renamed');
  });

  it('drops linked task tags from a list of ids', () => {
    const catalog = catalogOf('auth', 'v2');
    catalog.push(linked(catalog, 'fix', 'r1', 10));
    expect(withoutLinkedTags(catalog, ['lk-fix', 'tg-0', 'tg-1'])).toEqual(['tg-0', 'tg-1']);
  });

  it('reads a parent reference as a number and as a run id', () => {
    expect(parseParentRef(161)).toEqual({ id: null, number: 161 });
    expect(parseParentRef('161')).toEqual({ id: '161', number: 161 });
    expect(parseParentRef('#161')).toEqual({ id: '#161', number: 161 });
    expect(parseParentRef(' r1 ')).toEqual({ id: 'r1', number: null });
    expect(parseParentRef('#x')).toEqual({ id: '#x', number: null });
    expect(parseParentRef('0')).toEqual({ id: '0', number: null });
  });
});

describe('project catalogs', () => {
  const A = '/a';
  const B = '/b';
  const both = (): Tag[] => {
    const a = addTag([], { repository: A, name: 'auth' }, 'ta', 1);
    const b = addTag([], { repository: B, name: 'auth', color: 'pink' }, 'tb', 2);
    return [a, b];
  };

  it('puts the repository into the tag', () => {
    expect(addTag([], { repository: A, name: 'x' }, 'x', 1).repository).toBe(A);
    const linked = addLinkedTag(
      [],
      { repository: B, name: 'x', task: { run: 'r', number: 1 } },
      'x',
      1,
    );
    expect(linked.repository).toBe(B);
  });

  it('returns only the tags of the repository', () => {
    const catalog = both();
    expect(tagsOfRepository(catalog, A).map((tag) => tag.id)).toEqual(['ta']);
    expect(tagsOfRepository(catalog, B).map((tag) => tag.id)).toEqual(['tb']);
    expect(tagsOfRepository(catalog, '/c')).toEqual([]);
  });

  it('allows one name in two repositories', () => {
    const catalog = both();
    expect(() =>
      addTag(tagsOfRepository(catalog, A), { repository: A, name: 'AUTH' }, 'x', 3),
    ).toThrow('already exists');
    expect(tagsOfRepository(catalog, B)[0]!.color).toBe('pink');
  });

  it('counts the default color and free names inside the repository', () => {
    const catalog = [...both(), addTag([], { repository: A, name: 'second' }, 'ta2', 3)];
    const ofB = tagsOfRepository(catalog, B);
    expect(addTag(ofB, { repository: B, name: 'next' }, 'x', 4).color).toBe(TAG_COLORS[1]);
    expect(autoTagName(tagsOfRepository(catalog, A), 'second')).toBe('second-2');
    expect(autoTagName(ofB, 'second')).toBe('second');
  });

  it('does not find the tag of another repository', () => {
    const catalog = [addTag([], { repository: A, name: 'only-a' }, 'ta', 1)];
    const ofB = tagsOfRepository(catalog, B);
    expect(() => findTag(ofB, 'only-a')).toThrow('unknown tag `only-a`');
    expect(() => resolveManualTags(ofB, ['only-a'])).toThrow('unknown tag');
  });
});
