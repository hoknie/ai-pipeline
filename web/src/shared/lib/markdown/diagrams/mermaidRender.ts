import { renderMermaidSVG } from 'beautiful-mermaid';

/** ELK's bundled synchronous adapter must not register itself as this Worker's message handler. */
export function renderMermaid(source: string): string {
  // In a browser Worker `self` is inherited and deleting it does not hide it from ELK.
  // A document sentinel selects ELK's bundled fake worker instead of its global worker mode.
  // It has no DOM, browsing context, navigation, executable nodes or resource loaders.
  if (typeof document === 'undefined') Object.assign(globalThis, { document: Object.freeze({}) });
  return renderMermaidSVG(source);
}
