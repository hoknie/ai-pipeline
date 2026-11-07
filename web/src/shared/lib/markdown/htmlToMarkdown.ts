/**
 * Turns pasted HTML into Markdown. The HTML is parsed into an inert document (no script runs, no
 * handler fires, no image loads) and walked by hand. Returns `null` when the HTML has no
 * meaningful markup (headings, lists, emphasis, links, code, tables…): then the caller keeps the
 * plain text, which is what a source such as a code editor wants.
 */

/** Boundary between blocks; folded into blank lines when a container is finished. */
const BOUNDARY = '\u0001';

const SEMANTIC =
  'h1,h2,h3,h4,h5,h6,ul,ol,li,em,i,s,del,strike,a[href],code,pre,blockquote,table,hr,img';
const HEADING = /^H([1-6])$/;
const BLOCKS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'MAIN',
  'ASIDE',
  'NAV',
  'FIGURE',
  'FIGCAPTION',
  'DETAILS',
  'SUMMARY',
  'ADDRESS',
  'DL',
  'DT',
  'DD',
  'FORM',
  'FIELDSET',
  'CENTER',
]);
const DROPPED = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'HEAD',
  'NOSCRIPT',
  'TITLE',
  'META',
  'LINK',
]);

function style(el: Element): string {
  return (el.getAttribute('style') ?? '').toLowerCase();
}

function isBold(el: Element): boolean {
  const css = style(el);
  const weight = /font-weight\s*:\s*(bold|bolder|\d+|normal)/.exec(css)?.[1];
  if (el.nodeName === 'B' || el.nodeName === 'STRONG') {
    return !(weight === 'normal' || weight === '400' || weight === '300');
  }
  if (weight === undefined) return false;
  return weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
}

function isItalic(el: Element): boolean {
  return el.nodeName === 'EM' || el.nodeName === 'I' || /font-style\s*:\s*italic/.test(style(el));
}

function isStruck(el: Element): boolean {
  return (
    ['S', 'DEL', 'STRIKE'].includes(el.nodeName) ||
    /text-decoration[^;]*line-through/.test(style(el))
  );
}

function hasMeaning(doc: Document): boolean {
  if (doc.body.querySelector(SEMANTIC) !== null) return true;
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (['B', 'STRONG', 'SPAN'].includes(el.nodeName) && isBold(el)) return true;
    if (el.nodeName === 'SPAN' && (isItalic(el) || isStruck(el))) return true;
  }
  return false;
}

function block(content: string): string {
  return `${BOUNDARY}${content}${BOUNDARY}`;
}

/** Folds the boundaries into blank lines (`tight`: single line breaks) and trims the edges. */
function finish(text: string, tight: boolean): string {
  return text
    .replace(/[ \t\n]*\u0001[\u0001 \t\n]*/g, tight ? '\n' : '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/^[ \t]+|[ \t]+$/g, '');
}

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

export function fence(code: string, min: number): string {
  let length = min;
  for (const run of code.match(/`+/g) ?? []) length = Math.max(length, run.length + 1);
  return '`'.repeat(length);
}

function language(pre: Element): string {
  for (const el of [pre, ...Array.from(pre.querySelectorAll('code'))]) {
    const match = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(el.getAttribute('class') ?? '');
    if (match) return match[1]!;
  }
  return '';
}

function safeLink(href: string): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = href.replace(/[\u0000- ]/g, '');
  if (cleaned === '' || /^(javascript|vbscript|data|file):/i.test(cleaned)) return null;
  return href.trim().replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function safeImage(src: string): string | null {
  const trimmed = src.trim();
  if (!/^(https?:\/\/|data:image\/)/i.test(trimmed)) return null;
  return trimmed.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function wrap(marker: string, text: string): string {
  if (text.trim() === '') return text;
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  return `${lead}${marker}${text.trim()}${marker}${trail}`;
}

function renderChildren(parent: Node): string {
  let out = '';
  for (const child of Array.from(parent.childNodes)) out += renderNode(child);
  return out;
}

function renderText(node: Text): string {
  let text = (node.nodeValue ?? '').replace(/[ \t\r\n\f\u00a0]+/g, ' ');
  const next = node.nextSibling;
  const lineStart = startsLine(node);
  if (lineStart) text = text.replace(/^ /, '');
  if (next?.nodeName === 'BR') text = text.replace(/ $/, '');
  let escaped = escapeText(text);
  if (lineStart) {
    escaped = escaped.replace(/^([#>+-])(?= |$)/, '\\$1').replace(/^(\d+)([.)])(?= |$)/, '$1\\$2');
  }
  return escaped;
}

/** True when nothing but a line break or a block boundary precedes the node on its line. */
function startsLine(node: Node): boolean {
  let current: Node = node;
  for (;;) {
    const prev = current.previousSibling;
    if (prev !== null) {
      if (prev.nodeType === 3 && (prev.nodeValue ?? '').trim() === '') {
        current = prev;
        continue;
      }
      return prev.nodeName === 'BR' || (prev.nodeType === 1 && isBlock(prev as Element));
    }
    const parent = current.parentNode;
    if (parent === null || parent.nodeType !== 1) return true;
    const el = parent as Element;
    if (el.nodeName === 'BODY' || isBlock(el)) return true;
    current = el;
  }
}

function isBlock(el: Element): boolean {
  return (
    BLOCKS.has(el.nodeName) ||
    HEADING.test(el.nodeName) ||
    ['UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR'].includes(el.nodeName)
  );
}

function renderList(list: Element): string {
  const ordered = list.nodeName === 'OL';
  let n = Number.parseInt(list.getAttribute('start') ?? '1', 10);
  if (!Number.isFinite(n)) n = 1;
  const lines: string[] = [];
  for (const item of Array.from(list.children)) {
    if (item.nodeName !== 'LI') {
      const loose = finish(renderNode(item), true);
      if (loose !== '') lines.push(loose);
      continue;
    }
    let task = '';
    const box = Array.from(item.children).find(
      (el) => el.nodeName === 'INPUT' && el.getAttribute('type') === 'checkbox',
    );
    if (box) task = box.hasAttribute('checked') ? '[x] ' : '[ ] ';
    const marker = ordered ? `${n}. ` : '- ';
    n += 1;
    const body = finish(renderChildren(item), true);
    const pad = ' '.repeat(marker.length);
    const text = `${task}${body}`.split('\n').join(`\n${pad}`);
    lines.push(`${marker}${text}`.replace(/\s+$/, ''));
  }
  return block(lines.join('\n'));
}

function cellText(cell: Element): string {
  return finish(renderChildren(cell), true)
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|');
}

function renderTable(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children)
      .filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH')
      .map(cellText),
  );
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width === 0) return '';
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const [head, ...rest] = rows;
  const out = [line(head!), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`];
  for (const row of rest) out.push(line(row));
  return block(out.join('\n'));
}

function renderElement(el: Element): string {
  const name = el.nodeName;
  if (DROPPED.has(name)) return '';
  const heading = HEADING.exec(name);
  if (heading) {
    const text = finish(renderChildren(el), true).replace(/\s*\n\s*/g, ' ');
    return text === '' ? '' : block(`${'#'.repeat(Number(heading[1]))} ${text}`);
  }
  switch (name) {
    case 'BR':
      return '  \n';
    case 'HR':
      return block('---');
    case 'UL':
    case 'OL':
      return renderList(el);
    case 'TABLE':
      return renderTable(el);
    case 'BLOCKQUOTE': {
      const text = finish(renderChildren(el), false);
      if (text === '') return '';
      return block(
        text
          .split('\n')
          .map((l) => (l === '' ? '>' : `> ${l}`))
          .join('\n'),
      );
    }
    case 'PRE': {
      const code = (el.textContent ?? '').replace(/^\n/, '').replace(/\n$/, '');
      const ticks = fence(code, 3);
      return block(`${ticks}${language(el)}\n${code}\n${ticks}`);
    }
    case 'CODE': {
      const code = (el.textContent ?? '').replace(/\s+/g, ' ');
      if (code.trim() === '') return code;
      const ticks = fence(code, 1);
      const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
      return `${ticks}${pad}${code}${pad}${ticks}`;
    }
    case 'IMG': {
      const alt = (el.getAttribute('alt') ?? '').replace(/[[\]]/g, '');
      const src = safeImage(el.getAttribute('src') ?? '');
      return src === null ? escapeText(alt) : `![${alt}](${src})`;
    }
    case 'A': {
      const text = renderChildren(el);
      const href = safeLink(el.getAttribute('href') ?? '');
      if (href === null) return text;
      if (text.trim() === '') return `<${href}>`;
      if (text.trim() === href) return `<${href}>`;
      return `[${text.trim()}](${href})`;
    }
    default:
  }
  let text = renderChildren(el);
  if (isStruck(el)) text = wrap('~~', text);
  if (isItalic(el)) text = wrap('*', text);
  if (isBold(el)) text = wrap('**', text);
  return isBlock(el) ? block(text) : text;
}

function renderNode(node: Node): string {
  if (node.nodeType === 3) return renderText(node as Text);
  if (node.nodeType === 1) return renderElement(node as Element);
  return '';
}

export function htmlToMarkdown(html: string): string | null {
  if (html.trim() === '') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!hasMeaning(doc)) return null;
  const md = finish(renderChildren(doc.body), false);
  return md === '' ? null : md;
}
