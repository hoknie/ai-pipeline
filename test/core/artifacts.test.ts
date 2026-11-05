import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_FILE_NAME_LIMIT,
  artifactPreview,
  artifactTitle,
  validArtifactFileName,
} from '../../src/core/index.ts';

describe('artifactPreview', () => {
  it('previews md as markdown and log as log, whatever the case', () => {
    expect(artifactPreview('report.md')).toBe('markdown');
    expect(artifactPreview('REPORT.MD')).toBe('markdown');
    expect(artifactPreview('build.log')).toBe('log');
    expect(artifactPreview('Build.LOG')).toBe('log');
  });

  it('gives null for other files, hidden files and names without an extension', () => {
    expect(artifactPreview('data.zip')).toBeNull();
    expect(artifactPreview('page.html')).toBeNull();
    expect(artifactPreview('md')).toBeNull();
    expect(artifactPreview('.md')).toBeNull();
    expect(artifactPreview('log.txt')).toBeNull();
  });
});

describe('artifactTitle', () => {
  it('drops the last extension only', () => {
    expect(artifactTitle('report.md')).toBe('report');
    expect(artifactTitle('archive.tar.gz')).toBe('archive.tar');
  });

  it('keeps a name without an extension and a hidden file', () => {
    expect(artifactTitle('Makefile')).toBe('Makefile');
    expect(artifactTitle('.env')).toBe('.env');
  });
});

describe('validArtifactFileName', () => {
  it('accepts plain names, also non-latin ones', () => {
    expect(validArtifactFileName('report.md')).toBe(true);
    expect(validArtifactFileName('отчёт 1.md')).toBe(true);
    expect(validArtifactFileName('x'.repeat(ARTIFACT_FILE_NAME_LIMIT))).toBe(true);
  });

  it('refuses separators, NUL, dots, empty, padded and too long names', () => {
    expect(validArtifactFileName('')).toBe(false);
    expect(validArtifactFileName('.')).toBe(false);
    expect(validArtifactFileName('..')).toBe(false);
    expect(validArtifactFileName('a/b.md')).toBe(false);
    expect(validArtifactFileName('../a.md')).toBe(false);
    expect(validArtifactFileName('a\\b.md')).toBe(false);
    expect(validArtifactFileName('a\0.md')).toBe(false);
    expect(validArtifactFileName(' a.md')).toBe(false);
    expect(validArtifactFileName('x'.repeat(ARTIFACT_FILE_NAME_LIMIT + 1))).toBe(false);
  });
});
