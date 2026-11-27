import { htmlToMarkdown } from '../../../lib/markdown/htmlToMarkdown.ts';

/** Convert inert HTML into Markdown without carrying active resources into the editor. */
export function safePastedHtml(html: string): string | null {
  return htmlToMarkdown(html);
}
