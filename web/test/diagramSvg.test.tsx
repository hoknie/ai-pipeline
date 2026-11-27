// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { sanitizeDiagramSvg } from '../src/shared/lib/markdown/diagramsSvg.ts';

describe('diagram SVG sanitization', () => {
  it('reconstructs inert geometry and local marker references', () => {
    const svg = sanitizeDiagramSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><defs><marker id="arrow"><path d="M0 0 L5 5"/></marker></defs><path marker-end="url(#arrow)" d="M0 0 L10 10"/><text x="1">Hello</text></svg>',
    );
    expect(svg.querySelector('path[marker-end]')?.getAttribute('marker-end')).toBe(
      `url(#${svg.querySelector('marker')!.id})`,
    );
    expect(svg.querySelector('text')?.textContent).toBe('Hello');
  });

  it('drops active content, external references and event handlers without fetching', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    try {
      const svg = sanitizeDiagramSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)"><script>alert(1)</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">bad</div></foreignObject><image xlink:href="https://example.test/a"/><a xlink:href="javascript:alert(1)"><text>link</text></a><path fill="url(https://example.test/a)" marker-end="url(https://example.test/b)" onclick="alert(1)"/></svg>',
      );
      document.body.append(svg);
      expect(svg.querySelector('script, foreignObject, image, a')).toBeNull();
      expect(svg.hasAttribute('onload')).toBe(false);
      const path = svg.querySelector('path')!;
      expect(path.hasAttribute('fill')).toBe(false);
      expect(path.hasAttribute('marker-end')).toBe(false);
      expect(path.hasAttribute('onclick')).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
      svg.remove();
    } finally {
      fetch.mockRestore();
    }
  });

  it('rejects document type declarations and malformed SVG', () => {
    expect(() =>
      sanitizeDiagramSvg('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>'),
    ).toThrow();
    expect(() => sanitizeDiagramSvg('<svg><path></svg>')).toThrow();
  });
});
