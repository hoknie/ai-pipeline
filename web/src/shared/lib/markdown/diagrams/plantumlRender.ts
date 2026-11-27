import { renderToString } from '@plantuml/core';
import { instance } from '@viz-js/viz';
import { DOMParser } from '@xmldom/xmldom';
import { installPlantUmlDom } from './plantumlDom.ts';

let installed = false;

function checkResult(svg: string): string {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (document.documentElement?.localName !== 'svg') {
    throw new Error('PlantUML returned an invalid SVG');
  }
  const texts = Array.from(document.getElementsByTagName('text'));
  // The engine sends syntax/include errors through its success callback as a diagnostic drawing.
  // Match the diagnostic header AND source-location marker, not arbitrary user label text.
  const diagnostic =
    /^PlantUML version /.test(texts[0]?.textContent ?? '') &&
    texts.some((text) => /^\[From .+\(line \d+\)\s*\]/.test(text.textContent ?? ''));
  if (diagnostic) {
    throw new Error(texts.at(-1)?.textContent?.trim() || 'PlantUML could not render this diagram');
  }
  return svg;
}

/** Worker-only adapter. The caller owns timeout, input policy, network isolation and SVG sanitizing. */
export async function renderPlantUml(source: string): Promise<string> {
  if (!installed) {
    installPlantUmlDom();
    // Viz embeds its Wasm bytes; no URL loader or classic-script wrapper is needed.
    Object.assign(globalThis, { PLANTUML_VIZ: { instance } });
    installed = true;
  }
  const svg = await new Promise<string>((resolve, reject) => {
    renderToString(source.split(/\r?\n/), resolve, (message) => reject(new Error(message)), {
      maxSvgSize: 8192,
    });
  });
  return checkResult(svg);
}
