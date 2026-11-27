// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { installPlantUmlDom } from '../src/shared/lib/markdown/diagrams/plantumlDom.ts';

function context() {
  return {
    font: '',
    measureText: (text: string) =>
      ({
        width: text.length * 7,
        actualBoundingBoxLeft: 1,
        actualBoundingBoxRight: text.length * 7 - 1,
        actualBoundingBoxAscent: 11,
        actualBoundingBoxDescent: 3,
      }) as TextMetrics,
  };
}

const changedGlobals = [
  'window',
  'document',
  'DOMParser',
  'XMLSerializer',
  'PLANTUML_FILE_LOADER',
  'PLANTUML_STDLIB_LOADER',
  'PLANTUML_VIZ',
] as const;
const originals = new Map(
  changedGlobals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);

beforeEach(() => {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext = context;
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Network access is forbidden');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe('inert PlantUML document', () => {
  it('uses the canvas font and actual bounds, including inherited font attributes', () => {
    const measurement = context();
    const document = installPlantUmlDom(() => measurement);
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('font-family', 'monospace');
    group.setAttribute('font-weight', 'bold');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('font-size', '20');
    text.setAttribute('font-style', 'italic');
    text.setAttribute('x', '10');
    text.setAttribute('y', '30');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = 'Test';
    group.appendChild(text);
    expect(text.getBBox()).toEqual({ x: -5, y: 19, width: 28, height: 14 });
    expect(measurement.font).toBe('italic bold 20px monospace');
  });

  it('rejects HTML creation and every auxiliary loader without exposing navigation', () => {
    const document = installPlantUmlDom(context);
    for (const tag of ['script', 'img', 'iframe', 'a']) {
      expect(() => document.createElement(tag)).toThrow('resource loading is disabled');
    }
    expect(() => document.createElementNS('http://www.w3.org/1999/xhtml', 'a')).toThrow();
    expect(window).not.toHaveProperty('location');
    expect(document).not.toHaveProperty('location');
    const globals = globalThis as unknown as Record<string, (...args: unknown[]) => void>;
    const fail = vi.fn();
    globals.PLANTUML_FILE_LOADER!('file.puml', '', vi.fn(), fail);
    globals.PLANTUML_STDLIB_LOADER!('remote.js', vi.fn(), fail);
    expect(fail).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails instead of inventing metrics when worker canvas support is absent', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(() => installPlantUmlDom()).toThrow('OffscreenCanvas');
  });

  it('refuses installation in a browsing window', () => {
    vi.stubGlobal('window', { location: { href: 'https://example.invalid/' } });
    expect(() => installPlantUmlDom(context)).toThrow('isolated worker');
  });
});

describe('local PlantUML engine', () => {
  async function render(source: string) {
    // A fresh wrapper initializes globals for each test; the installed vendor engine is real.
    vi.resetModules();
    const { renderPlantUml } =
      await import('../src/shared/lib/markdown/diagrams/plantumlRender.ts');
    return renderPlantUml(source);
  }

  it('renders sequence text and shapes without network calls', async () => {
    const svg = await render('@startuml\nAlice -> Bob : Hello\n@enduml');
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(document.documentElement?.localName).toBe('svg');
    expect(svg).toContain('Alice');
    expect(svg).toContain('Hello');
    expect(document.getElementsByTagName('line').length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses embedded Viz layout for a class diagram and preserves methods', async () => {
    const svg = await render(
      '@startuml\nclass Animal {\n +eat()\n}\nclass Duck\nAnimal <|-- Duck\n@enduml',
    );
    expect(svg).toContain('Animal');
    expect(svg).toContain('Duck');
    expect(svg).toContain('eat()');
    expect(svg).toMatch(/<(?:path|polygon)\b/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects diagnostic SVGs for invalid syntax and inaccessible includes', async () => {
    await expect(render('@startuml\nthis is not a diagram !!!\n@enduml')).rejects.toThrow(
      'Syntax Error',
    );
    await expect(
      render('@startuml\n!include https://example.invalid/secret\nA -> B\n@enduml'),
    ).rejects.toThrow(/include/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not mistake a user label mentioning a syntax error for a diagnostic', async () => {
    const svg = await render('@startuml\nA -> B : Syntax Error?\n@enduml');
    expect(svg).toContain('Syntax Error?');
  });

  it('queues overlapping renders without losing their callbacks', async () => {
    vi.resetModules();
    const { renderPlantUml } =
      await import('../src/shared/lib/markdown/diagrams/plantumlRender.ts');
    const results = await Promise.all([
      renderPlantUml('@startuml\nAlice -> Bob : First\n@enduml'),
      renderPlantUml('@startuml\nAlice -> Bob : Second\n@enduml'),
    ]);
    expect(results[0]).toContain('First');
    expect(results[1]).toContain('Second');
    expect(fetch).not.toHaveBeenCalled();
  });
});
