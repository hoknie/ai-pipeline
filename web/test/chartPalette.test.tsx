import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assignColors,
  FALLBACK_COLORS,
  FALLBACK_COUNT,
  projectShade,
} from '../src/shared/ui/charts/palette.ts';

const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');

/** Linear sRGB channels of an `oklch(L C h)`. */
function oklchToLinear(l: number, c: number, hue: number): number[] {
  const a = c * Math.cos((hue * Math.PI) / 180);
  const b = c * Math.sin((hue * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((channel) => Math.min(1, Math.max(0, channel)));
}

const luminance = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;

function contrast(left: number[], right: number[]): number {
  const [high, low] = [luminance(left), luminance(right)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

/** The oklch tokens of a block of the stylesheet, by name. */
function tokens(block: string): Map<string, number[]> {
  const found = new Map<string, number[]>();
  for (const match of block.matchAll(
    /--color-([a-z0-9-]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g,
  )) {
    found.set(match[1]!, oklchToLinear(Number(match[2]), Number(match[3]), Number(match[4])));
  }
  return found;
}

const darkAt = css.indexOf('\n.dark {');
const themes = { light: tokens(css.slice(0, darkAt)), dark: tokens(css.slice(darkAt)) };

describe('assignColors', () => {
  it('gives the color of a project from the registry', () => {
    expect(assignColors(['/a'], () => 'blue')).toEqual({ '/a': projectShade('blue') });
    expect(projectShade('blue')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('gives the others the fallback colors in order, and the same every time', () => {
    const colorOf = (key: string) => (key === '/b' ? 'green' : null);
    const first = assignColors(['/a', '/b', '/c'], colorOf);
    expect(first['/a']).toBe(FALLBACK_COLORS[0]);
    expect(first['/c']).toBe(FALLBACK_COLORS[1]);
    expect(assignColors(['/a', '/b', '/c'], colorOf)).toEqual(first);
  });

  it('wraps after the last fallback color', () => {
    const keys = Array.from({ length: FALLBACK_COUNT + 1 }, (_, index) => `/p${index}`);
    const colors = assignColors(keys, () => null);
    expect(colors[`/p${FALLBACK_COUNT}`]).toBe(FALLBACK_COLORS[0]);
  });

  it('ignores a color name it does not know', () => {
    expect(assignColors(['/a'], () => 'plaid')['/a']).toBe(FALLBACK_COLORS[0]);
  });
});

describe('the fallback palette in both themes', () => {
  it('has eight tokens in the light and in the dark theme', () => {
    expect(FALLBACK_COLORS).toHaveLength(8);
    for (const theme of [themes.light, themes.dark]) {
      for (let index = 1; index <= 8; index += 1) {
        expect(theme.has(`chart-${index}`)).toBe(true);
      }
    }
  });

  it('keeps every color readable against the card of its theme', () => {
    for (const [name, theme] of Object.entries(themes)) {
      const card = theme.get('card')!;
      for (let index = 1; index <= 8; index += 1) {
        expect(
          contrast(theme.get(`chart-${index}`)!, card),
          `${name} chart-${index}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
