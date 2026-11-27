import type { Node } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';
import type { ElementContent, RootContent } from 'hast';
import { highlightCode } from '../../../lib/markdown/highlightCode.ts';
import { diagramView } from './diagrams/diagramView.ts';

function tokenDOM(token: ElementContent | RootContent): globalThis.Node {
  if (token.type === 'text') return document.createTextNode(token.value);
  const span = document.createElement('span');
  if (token.type === 'element') {
    const classes = token.properties.className;
    if (Array.isArray(classes)) span.className = classes.join(' ');
    span.append(...token.children.map(tokenDOM));
  }
  return span;
}

/** Never mount source HTML; even unsupported HTML and diagram text are inert text. */
export function rawBlockView(
  node: Node,
  labels?: { loading: string; error: string; diagram: string },
): NodeView {
  const dom = document.createElement('div');
  dom.contentEditable = 'false';
  dom.setAttribute('data-raw-markdown', 'true');
  const pre = document.createElement('pre');
  pre.className = 'markdown-code';
  if (node.attrs.code !== null) {
    const code = document.createElement('code');
    code.append(...highlightCode(node.attrs.language, node.attrs.code).map(tokenDOM));
    pre.append(code);
  } else pre.textContent = node.attrs.raw;
  dom.append(pre);
  const destroy =
    labels && ['mermaid', 'plantuml'].includes(node.attrs.language)
      ? diagramView(dom, node.attrs.language, node.attrs.code, labels)
      : undefined;
  return { dom, ignoreMutation: () => true, destroy };
}
