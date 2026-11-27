// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeDiagramSvg } from '../src/shared/lib/markdown/diagramsSvg.ts';

describe('sanitizeDiagramSvg', () => {
  it('preserves inert shapes and local marker references', () => {
    const svg = sanitizeDiagramSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
      <defs><marker id="arrow"><path d="M0 0L5 5"/></marker></defs>
      <path marker-end="url(#arrow)" d="M0 0L10 10"/><text>Safe &amp; visible</text>
    </svg>`);
    const id = svg.querySelector('marker')!.id;
    expect(id).toMatch(/^aip-diagram-\d+-arrow$/);
    expect(svg.querySelector('path[marker-end]')?.getAttribute('marker-end')).toBe(`url(#${id})`);
    expect(svg.querySelector('text')?.textContent).toBe('Safe & visible');
  });

  it('drops active elements, external resources, CSS and event handlers', () => {
    const svg =
      sanitizeDiagramSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <script>alert(1)</script><style>@import url(https://evil.test)</style>
      <foreignObject><img xmlns="http://www.w3.org/1999/xhtml" src="https://evil.test"/></foreignObject>
      <image xlink:href="https://evil.test"/><a href="https://evil.test"><text>link</text></a>
      <rect onload="alert(1)" style="fill:url(https://evil.test)" fill="url(https://evil.test)"/>
    </svg>`);
    expect(svg.querySelector('script,style,foreignObject,image,a')).toBeNull();
    expect(svg.querySelector('rect')?.attributes.length).toBe(0);
    expect(svg.outerHTML).not.toContain('evil.test');
  });

  it('rejects malformed XML, entities and excessive output', () => {
    expect(() => sanitizeDiagramSvg('<svg>')).toThrow();
    expect(() =>
      sanitizeDiagramSvg('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>'),
    ).toThrow();
    expect(() => sanitizeDiagramSvg('x'.repeat(2_000_001))).toThrow();
  });
});
