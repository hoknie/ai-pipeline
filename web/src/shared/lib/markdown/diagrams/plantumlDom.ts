import { DOMImplementation, DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type {
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export type PlantUmlContext = Pick<OffscreenCanvasRenderingContext2D, 'font' | 'measureText'>;
type ContextFactory = () => PlantUmlContext;
type MeasuredElement = XmlElement & {
  style: Record<string, string>;
  getBBox: () => { x: number; y: number; width: number; height: number };
};
type InertDocument = Omit<XmlDocument, 'createElement' | 'createElementNS'> & {
  body: XmlElement;
  createElement: (tag: string) => { getContext: (kind: string) => PlantUmlContext };
  createElementNS: (namespace: string, tag: string) => MeasuredElement;
};

function canvasContext(): PlantUmlContext {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('PlantUML requires OffscreenCanvas text measurement');
  }
  const context = new OffscreenCanvas(1, 1).getContext('2d');
  if (!context) throw new Error('PlantUML requires a 2D canvas context');
  return context;
}

function inheritedAttribute(element: XmlElement, name: string, fallback: string): string {
  let node: XmlElement | null = element;
  while (node) {
    const value = node.getAttribute(name);
    if (value) return value;
    const parent: XmlNode | null = node.parentNode;
    node = parent?.nodeType === 1 ? (parent as XmlElement) : null;
  }
  return fallback;
}

function textBounds(element: XmlElement, createContext: ContextFactory) {
  if (!['text', 'tspan'].includes(element.localName ?? '')) {
    throw new Error('Unsupported PlantUML geometry measurement');
  }
  const context = createContext();
  const size = inheritedAttribute(element, 'font-size', '16');
  const family = inheritedAttribute(element, 'font-family', 'sans-serif');
  const weight = inheritedAttribute(element, 'font-weight', 'normal');
  const style = inheritedAttribute(element, 'font-style', 'normal');
  const fontSize = /^\d+(?:\.\d+)?$/.test(size) ? `${size}px` : size;
  context.font = '10px sans-serif';
  context.font = `${style} ${weight} ${fontSize} ${family}`;
  const metrics = context.measureText(element.textContent ?? '');
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  const left = metrics.actualBoundingBoxLeft;
  const right = metrics.actualBoundingBoxRight;
  if (![ascent, descent, left, right, metrics.width].every(Number.isFinite)) {
    throw new Error('PlantUML canvas text metrics are unavailable');
  }
  const anchor = inheritedAttribute(element, 'text-anchor', 'start');
  const offset = anchor === 'middle' ? metrics.width / 2 : anchor === 'end' ? metrics.width : 0;
  return {
    x: Number.parseFloat(element.getAttribute('x') ?? '0') - left - offset,
    y: Number.parseFloat(element.getAttribute('y') ?? '0') - ascent,
    width: left + right,
    height: ascent + descent,
  };
}

/** XML nodes have no browsing context, resource loading, or executable HTML elements. */
export function installPlantUmlDom(createContext: ContextFactory = canvasContext): InertDocument {
  if (typeof window !== 'undefined' && 'location' in window) {
    throw new Error('PlantUML must run in an isolated worker');
  }
  // Fail early instead of returning an empty or approximately measured diagram.
  createContext();
  const document = new DOMImplementation().createDocument(null, 'root');
  const createElementNS = document.createElementNS.bind(document);
  const inert = Object.assign(document, {
    body: document.documentElement!,
    getElementById: () => null,
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`PlantUML resource loading is disabled: ${tag}`);
      return {
        getContext(kind: string) {
          if (kind !== '2d') throw new Error('Unsupported PlantUML canvas context');
          return createContext();
        },
      };
    },
    createElementNS(namespace: string, tag: string): MeasuredElement {
      if (namespace !== SVG_NAMESPACE) throw new Error('Only inert SVG nodes are supported');
      const element = createElementNS(namespace, tag);
      return Object.assign(element, {
        style: {} as Record<string, string>,
        getBBox: () => textBounds(element, createContext),
      });
    },
  });
  Object.assign(globalThis, {
    window: { document: inert },
    document: inert,
    DOMParser,
    XMLSerializer,
    PLANTUML_FILE_LOADER: (
      _path: string,
      _from: string,
      _success: unknown,
      fail: (message: string) => void,
    ) => fail('PlantUML file loading is disabled'),
    PLANTUML_STDLIB_LOADER: (_bundle: string, _success: unknown, fail: (message: string) => void) =>
      fail('PlantUML library loading is disabled'),
  });
  return inert;
}
