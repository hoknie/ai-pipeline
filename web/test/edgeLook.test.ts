import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { edgeLook } from '../src/shared/lib/graph/OrthogonalEdge.tsx';

describe('edgeLook', () => {
  it('draws a chosen connection with a colour that exists in the theme', () => {
    const stroke = (edgeLook(true) as { style: { stroke: string } }).style.stroke;
    const name = /^var\((--[\w-]+)\)$/.exec(stroke)?.[1];
    expect(name).toBeDefined();
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    expect(css).toContain(`${name}:`);
  });

  it('leaves an unchosen connection unstyled', () => {
    expect(edgeLook(false)).toEqual({ 'data-selected': undefined });
  });
});
