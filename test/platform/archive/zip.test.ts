import { describe, expect, it } from 'vitest';

import { readZip } from '../../../src/platform/archive/index.ts';
import { buildZip } from '../../fakes/zip.ts';

function problem(bytes: Buffer, limits?: Parameters<typeof readZip>[1]): string {
  try {
    readZip(bytes, limits);
  } catch (error) {
    return (error as Error).message;
  }
  return 'accepted';
}

describe('zip reader', () => {
  it('reads stored and deflated files and skips directories', () => {
    const files = readZip(
      buildZip([
        { name: 'skill/' },
        { name: 'skill/SKILL.md', data: 'hello '.repeat(50) },
        { name: 'skill/a/b.txt', data: 'stored', method: 0 },
        { name: 'skill/empty', data: '' },
      ]),
    );
    expect(files.map((file) => file.path)).toEqual([
      'skill/SKILL.md',
      'skill/a/b.txt',
      'skill/empty',
    ]);
    expect(files[0]?.data.toString()).toBe('hello '.repeat(50));
    expect(files[1]?.data.toString()).toBe('stored');
    expect(files[2]?.data.length).toBe(0);
  });

  it.each(['skill/../../.bashrc', '/etc/passwd', 'C:/x', 'a\\b', './x', 'a//b'])(
    'refuses the path %s',
    (name) => {
      expect(problem(buildZip([{ name, data: 'x' }]))).toMatch(/invalid archive/);
    },
  );

  it('refuses a symbolic link', () => {
    expect(problem(buildZip([{ name: 'skill/link', data: '/etc', mode: 0o120777 }]))).toMatch(
      /symbolic/,
    );
  });

  it('refuses duplicates, zip64, unknown methods and garbage', () => {
    expect(
      problem(
        buildZip([
          { name: 'a/x', data: '1' },
          { name: 'a/x', data: '2' },
        ]),
      ),
    ).toMatch(/duplicate/);
    expect(problem(buildZip([{ name: 'a/x', data: '1' }], { zip64: true }))).toMatch(/zip64/);
    expect(problem(buildZip([{ name: 'a/x', data: '1', method: 12 }]))).toMatch(/method/);
    expect(problem(Buffer.from('not a zip at all, definitely not'))).toMatch(/central directory/);
    expect(problem(Buffer.alloc(3))).toMatch(/too short/);
  });

  it('refuses a damaged file', () => {
    const bytes = buildZip([{ name: 'a/x', data: 'payload', method: 0 }]);
    const at = bytes.indexOf('payload');
    bytes[at] = bytes.readUInt8(at) ^ 0xff;
    expect(problem(bytes)).toMatch(/checksum/);
  });

  it('enforces the limits', () => {
    const many = Array.from({ length: 4 }, (_, index) => ({ name: `a/${index}`, data: 'x' }));
    const limits = { maxFiles: 3, maxFileBytes: 10, maxTotalBytes: 15, maxRatio: 50 };
    expect(problem(buildZip(many), limits)).toMatch(/more than 3 files/);
    expect(problem(buildZip([{ name: 'a/x', data: 'x'.repeat(11), method: 0 }]), limits)).toMatch(
      /too large/,
    );
    const together = [
      { name: 'a/1', data: '1'.repeat(8), method: 0 },
      { name: 'a/2', data: '2'.repeat(8), method: 0 },
    ];
    expect(problem(buildZip(together), limits)).toMatch(/together/);
  });

  it('refuses an archive that unpacks far beyond its size', () => {
    const bomb = buildZip([{ name: 'a/zeros', data: Buffer.alloc(4 * 1024 * 1024) }]);
    expect(problem(bomb)).toMatch(/packed too well/);
  });

  it('refuses a file larger than 5 MiB by default', () => {
    const big = buildZip([
      { name: 'a/big', data: Buffer.alloc(5 * 1024 * 1024 + 1, 1), method: 0 },
    ]);
    expect(problem(big)).toMatch(/too large/);
  });
});
