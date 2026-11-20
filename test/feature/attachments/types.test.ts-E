import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_TASK,
  attachmentMediaType,
  attachmentNameProblem,
  formatAttachmentSize,
} from '../../../src/feature/attachments/types/index.ts';

describe('attachment limits', () => {
  it('are 10 files of 20 MiB', () => {
    expect(ATTACHMENTS_PER_TASK).toBe(10);
    expect(ATTACHMENT_MAX_BYTES).toBe(20_971_520);
  });
});

describe('attachmentNameProblem', () => {
  it('accepts plain names, also non-latin ones', () => {
    expect(attachmentNameProblem('shot.png')).toBeNull();
    expect(attachmentNameProblem('скриншот 1.png')).toBeNull();
    expect(attachmentNameProblem('.env')).toBeNull();
  });

  it('refuses empty names, dots, separators and control characters', () => {
    for (const name of ['', '.', '..', '../x', 'a/b', 'a\\b', 'a\nb', 'a\u0000b', 'a\u007f']) {
      expect(attachmentNameProblem(name)).toContain('invalid attachment name');
    }
  });
});

describe('attachmentMediaType', () => {
  it('goes by the extension, whatever the case', () => {
    expect(attachmentMediaType('shot.PNG')).toBe('image/png');
    expect(attachmentMediaType('a.jpg')).toBe('image/jpeg');
    expect(attachmentMediaType('a.jpeg')).toBe('image/jpeg');
    expect(attachmentMediaType('spec.pdf')).toBe('application/pdf');
    expect(attachmentMediaType('run.log')).toBe('text/plain');
    expect(attachmentMediaType('logo.svg')).toBe('image/svg+xml');
  });

  it('is octet-stream for an unknown extension or none', () => {
    expect(attachmentMediaType('data.xyz')).toBe('application/octet-stream');
    expect(attachmentMediaType('Makefile')).toBe('application/octet-stream');
  });
});

describe('formatAttachmentSize', () => {
  it('shows bytes, KB and MB', () => {
    expect(formatAttachmentSize(512)).toBe('512 B');
    expect(formatAttachmentSize(2048)).toBe('2.0 KB');
    expect(formatAttachmentSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});
