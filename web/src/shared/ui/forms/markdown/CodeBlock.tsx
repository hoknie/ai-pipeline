import { highlightCode } from '../../../lib/markdown/highlightCode.ts';
import type { ElementContent, RootContent } from 'hast';
import type { ReactNode } from 'react';

function renderToken(node: ElementContent | RootContent, key: number): ReactNode {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return null;
  const classes = Array.isArray(node.properties.className)
    ? node.properties.className.join(' ')
    : undefined;
  return (
    <span key={key} className={classes}>
      {node.children.map(renderToken)}
    </span>
  );
}

/** Render highlighted tokens as React text nodes, never as executable HTML. */
export function CodeBlock({ language, code }: { language?: string | null; code: string }) {
  const content = highlightCode(language, code).map(renderToken);
  return (
    <pre className="markdown-code">
      <code>{content}</code>
    </pre>
  );
}
