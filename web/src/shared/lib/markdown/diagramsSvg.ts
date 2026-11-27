/** A deliberately small, inert subset of SVG for locally rendered diagrams. */
const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'marker',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
  'clipPath',
]);

const ATTRIBUTES = new Set([
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'transform',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'dx',
  'dy',
  'id',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
  'orient',
  'markerUnits',
  'marker-start',
  'marker-mid',
  'marker-end',
  'clip-path',
  'preserveAspectRatio',
]);

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MAX_SVG_LENGTH = 2_000_000;
const MAX_ELEMENTS = 20_000;
const REFERENCE = /^(?:none|url\(#[a-zA-Z_][\w.-]*\))$/;
const PALETTE: Record<string, string> = {
  '--bg': '#ffffff',
  '--fg': '#111827',
  '--_text': '#111827',
  '--_text-sec': '#5b6370',
  '--_text-muted': '#737b88',
  '--_text-faint': '#9ca3af',
  '--_line': '#707784',
  '--_arrow': '#273142',
  '--_node-fill': '#f8fafc',
  '--_node-stroke': '#9ca3af',
  '--_group-fill': '#ffffff',
  '--_group-hdr': '#f1f5f9',
  '--_inner-stroke': '#cbd5e1',
  '--_key-badge': '#e2e8f0',
};
const STYLE_ATTRIBUTES = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'opacity',
]);
let sequence = 0;

function attributes(source: Element): [string, string][] {
  const attrs: [string, string][] = Array.from(source.attributes)
    .filter((attr) => attr.namespaceURI === null && ATTRIBUTES.has(attr.name))
    .map((attr) => [attr.name, attr.value]);
  for (const declaration of (source.getAttribute('style') ?? '').split(';')) {
    const at = declaration.indexOf(':');
    const name = declaration.slice(0, at).trim();
    if (at > 0 && STYLE_ATTRIBUTES.has(name)) attrs.push([name, declaration.slice(at + 1)]);
  }
  return attrs;
}

/**
 * Parse as XML and reconstruct only known SVG nodes and attributes. Never insert the input SVG
 * into the document. This intentionally drops CSS, links, images and HTML foreign objects.
 * The caller should display a source/error fallback if this restricted representation is not
 * sufficient for a particular renderer's output.
 */
export function sanitizeDiagramSvg(svg: string): SVGSVGElement {
  if (svg.length > MAX_SVG_LENGTH || /<!DOCTYPE|<!ENTITY/i.test(svg)) {
    throw new Error('Invalid or oversized diagram SVG');
  }
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (
    root.localName !== 'svg' ||
    root.namespaceURI !== SVG_NAMESPACE ||
    parsed.getElementsByTagName('parsererror').length
  ) {
    throw new Error('Invalid diagram SVG');
  }
  let count = 0;
  const prefix = `aip-diagram-${++sequence}-`;
  function copy(source: Element): Element {
    if (++count > MAX_ELEMENTS) throw new Error('Oversized diagram SVG');
    const target = document.createElementNS(SVG_NAMESPACE, source.localName);
    for (const [name, original] of attributes(source)) {
      const value = original
        .trim()
        .replace(/var\((--[\w-]+)\)/g, (_match, key: string) => PALETTE[key] ?? 'none');
      if (/url\s*\(|[<>\\]|[\u0000-\u001f]/i.test(value)) {
        if (
          !['marker-start', 'marker-mid', 'marker-end', 'clip-path'].includes(name) ||
          !REFERENCE.test(value)
        )
          continue;
      }
      if (
        ['marker-start', 'marker-mid', 'marker-end', 'clip-path'].includes(name) &&
        !REFERENCE.test(value)
      )
        continue;
      target.setAttribute(
        name,
        name === 'id' ? prefix + value : value.replace(/url\(#([\w.-]+)\)/g, `url(#${prefix}$1)`),
      );
    }
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE)
        target.appendChild(document.createTextNode(child.textContent ?? ''));
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        if (element.namespaceURI === SVG_NAMESPACE && ELEMENTS.has(element.localName))
          target.appendChild(copy(element));
      }
    }
    return target;
  }
  return copy(root) as SVGSVGElement;
}
