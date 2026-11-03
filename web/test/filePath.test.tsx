// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FilePath } from '../src/components/FilePath.tsx';

afterEach(cleanup);

describe('FilePath', () => {
  it('truncates in the line variant', () => {
    render(<FilePath variant="line" path="/repo/aip/a.yaml" />);
    const code = screen.getByText('/repo/aip/a.yaml');
    expect(code.tagName).toBe('CODE');
    expect(code.getAttribute('title')).toBe('/repo/aip/a.yaml');
    expect(code.className).toContain('bg-muted');
    expect(code.className).toContain('truncate');
    expect(code.className).toContain('self-start');
    expect(code.className).toContain('w-fit');
    expect(code.className).not.toContain('break-all');
  });

  it('wraps in the inline variant, which is the default', () => {
    render(<FilePath path="docs/a.md" />);
    const code = screen.getByText('docs/a.md');
    expect(code.getAttribute('title')).toBe('docs/a.md');
    expect(code.className).toContain('bg-muted');
    expect(code.className).toContain('break-all');
    expect(code.className).not.toContain('truncate');
  });
});
