import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  maxSatisfying,
  parseRange,
  parseVersion,
} from '../../../src/feature/service-registry/types/index.ts';

describe('versions', () => {
  it('parses and orders versions, pre-releases below the release', () => {
    const order = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-beta',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.10.0',
      '2.0.0',
    ];
    for (let index = 1; index < order.length; index += 1) {
      const low = parseVersion(order[index - 1]!)!;
      const high = parseVersion(order[index]!)!;
      expect(compareVersions(low, high)).toBeLessThan(0);
      expect(compareVersions(high, low)).toBeGreaterThan(0);
    }
  });

  it('rejects texts that are not versions', () => {
    for (const text of ['1.2', 'v1.2.3', '01.2.3', '1.2.3.4', '', 'latest']) {
      expect(parseVersion(text)).toBeNull();
    }
  });
});

describe('ranges', () => {
  const all = [
    '0.2.3',
    '0.2.9',
    '0.3.0',
    '1.2.0',
    '1.2.9',
    '1.4.1',
    '1.9.0',
    '2.0.0',
    '2.1.0',
    '3.0.0',
  ];
  const table: [string, string | null][] = [
    ['^1', '1.9.0'],
    ['^1.2', '1.9.0'],
    ['^1.2.0', '1.9.0'],
    ['^0.2.3', '0.2.9'],
    ['^0.2', '0.2.9'],
    ['~1.2', '1.2.9'],
    ['~1.2.0', '1.2.9'],
    ['~1', '1.9.0'],
    ['1.x', '1.9.0'],
    ['1.4.x', '1.4.1'],
    ['*', '3.0.0'],
    ['x', '3.0.0'],
    ['1.4.1', '1.4.1'],
    ['=1.4.1', '1.4.1'],
    ['1', '1.9.0'],
    ['>=1 <3', '2.1.0'],
    ['>1.4.1 <2', '1.9.0'],
    ['>= 1.4 < 2', '1.9.0'],
    ['<=1.2.0', '1.2.0'],
    ['<1', '0.3.0'],
    ['^0.2 || ^2', '2.1.0'],
    ['1.2.0 || 1.4.1', '1.4.1'],
    ['^4', null],
    ['>3', null],
  ];

  it.each(table)('%s picks %s', (range, expected) => {
    expect(maxSatisfying(all, range)).toBe(expected);
  });

  it('picks the highest without a range', () => {
    expect(maxSatisfying(all, null)).toBe('3.0.0');
    expect(maxSatisfying(['1.2.0', '1.4.1', '2.0.0'], '^1')).toBe('1.4.1');
  });

  it('finds nothing when only other majors exist', () => {
    expect(maxSatisfying(['2.0.0', '2.1.0'], '^1')).toBeNull();
    expect(maxSatisfying([], '^1')).toBeNull();
  });

  it('skips texts that are not versions', () => {
    expect(maxSatisfying(['nope', '1.0.0'], null)).toBe('1.0.0');
  });

  it('admits a pre-release only when the range names one of that version', () => {
    const versions = ['1.2.0', '1.3.0-rc.1', '1.3.0', '2.0.0-rc.1'];
    expect(maxSatisfying(['1.2.0', '1.3.0-rc.1'], '^1')).toBe('1.2.0');
    expect(maxSatisfying(['1.3.0-rc.1'], '*')).toBeNull();
    expect(maxSatisfying(['1.3.0-rc.1', '1.2.0'], '^1.3.0-rc.1')).toBe('1.3.0-rc.1');
    expect(maxSatisfying(versions, '^1')).toBe('1.3.0');
    expect(maxSatisfying(versions, '>=2.0.0-rc.1')).toBe('2.0.0-rc.1');
    expect(maxSatisfying(['1.4.0-rc.1'], '>=1.3.0-rc.1')).toBeNull();
  });

  it('rejects invalid ranges', () => {
    for (const range of ['^^1', '1.x.3', 'abc', '>', '1..2', '^', '1.2.3.4', '~~1']) {
      expect(parseRange(range)).toBeNull();
    }
  });
});
