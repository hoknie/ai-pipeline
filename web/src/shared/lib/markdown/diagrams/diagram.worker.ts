import { renderMermaid } from './mermaidRender.ts';
import { renderPlantUml } from './plantumlRender.ts';
import { disableDiagramNetwork, MAX_DIAGRAM_SVG, validateDiagramSource } from './policy.ts';
import type { DiagramLanguage } from './policy.ts';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (data: unknown) => void;
};
disableDiagramNetwork(globalThis);

scope.onmessage = async (event) => {
  try {
    const data: unknown = event.data;
    if (
      !data ||
      typeof data !== 'object' ||
      !('language' in data) ||
      !('source' in data) ||
      !['mermaid', 'plantuml'].includes(String(data.language)) ||
      typeof data.source !== 'string'
    )
      throw new Error('Invalid diagram request');
    const language = data.language as DiagramLanguage;
    validateDiagramSource(language, data.source);
    const svg =
      language === 'mermaid' ? renderMermaid(data.source) : await renderPlantUml(data.source);
    if (svg.length > MAX_DIAGRAM_SVG) throw new Error('Oversized diagram SVG');
    scope.postMessage({ ok: true, svg });
  } catch {
    // Do not return library errors that may repeat private source or contain HTML.
    scope.postMessage({ ok: false });
  }
};
