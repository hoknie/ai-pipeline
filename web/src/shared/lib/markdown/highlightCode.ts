import { common, createLowlight } from 'lowlight';
import type { RootContent } from 'hast';

const highlighter = createLowlight(common);

export function highlightCode(language: string | null | undefined, code: string): RootContent[] {
  if (language && highlighter.registered(language)) {
    try {
      return highlighter.highlight(language, code).children;
    } catch {
      // Rendering failures must never hide or alter the source.
    }
  }
  return [{ type: 'text', value: code }];
}
