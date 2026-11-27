export type DiagramLanguage = 'mermaid' | 'plantuml';
export const MAX_DIAGRAM_SOURCE = 32_000;
export const MAX_DIAGRAM_SVG = 2_000_000;
export const DIAGRAM_TIMEOUT = 15_000;

/** Additional source policy, not the isolation boundary (the Worker CSP is that boundary). */
export function validateDiagramSource(language: DiagramLanguage, source: string): void {
  if (!source.trim() || source.length > MAX_DIAGRAM_SOURCE) throw new Error('Invalid diagram size');
  // Includes, themes, sprites, and HTML images may attempt to resolve external assets.
  // Local diagrams deliberately have no resource loader or extensible directives.
  if (
    language === 'plantuml' &&
    /!\s*(?:include|import|theme|pragma|function|procedure)|<\s*img\b|<\s*image\b/i.test(source)
  )
    throw new Error('Diagram resources and preprocessor extensions are disabled');
  if (language === 'mermaid' && /%%\{|^\s*---|\bclick\s|@\{[^}]*\bimg\s*:/im.test(source))
    throw new Error('Diagram configuration and external resources are disabled');
}

/** Defence in depth; CSP also denies imports, nested workers, network and script evaluation. */
export function disableDiagramNetwork(scope: object): void {
  const blocked = () => {
    throw new Error('Diagram network access is disabled');
  };
  for (const name of [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'WebTransport',
    'RTCPeerConnection',
    'Worker',
    'SharedWorker',
    'importScripts',
  ]) {
    Object.defineProperty(scope, name, { value: blocked, writable: false, configurable: false });
  }
}
