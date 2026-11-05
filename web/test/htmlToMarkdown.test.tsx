// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { htmlToMarkdown } from '../src/lib/htmlToMarkdown.ts';

describe('htmlToMarkdown', () => {
  it('returns null without meaningful markup', () => {
    expect(htmlToMarkdown('')).toBeNull();
    expect(
      htmlToMarkdown('<div><span>const a = 1;</span></div><div><span>b</span></div>'),
    ).toBeNull();
    expect(htmlToMarkdown('<p>just text</p>')).toBeNull();
  });

  it('converts headings and paragraphs', () => {
    expect(htmlToMarkdown('<h1>Title</h1><p>One</p><h3>Sub <em>x</em></h3><p>Two</p>')).toBe(
      '# Title\n\nOne\n\n### Sub *x*\n\nTwo',
    );
  });

  it('converts emphasis, strike-through and styled spans', () => {
    expect(htmlToMarkdown('<p><strong>a</strong> <em>b</em> <del>c</del> <b>d </b>e</p>')).toBe(
      '**a** *b* ~~c~~ **d** e',
    );
    expect(
      htmlToMarkdown(
        '<p><span style="font-weight:700">B</span> <span style="font-style:italic">I</span></p>',
      ),
    ).toBe('**B** *I*');
  });

  it('converts inline code and widens the fence', () => {
    expect(htmlToMarkdown('<p>use <code>a</code> and <code>x`y</code></p>')).toBe(
      'use `a` and ``x`y``',
    );
  });

  it('converts a code block with its language', () => {
    expect(
      htmlToMarkdown('<pre><code class="language-ts">const a = 1;\n\nlet b;\n</code></pre>'),
    ).toBe('```ts\nconst a = 1;\n\nlet b;\n```');
  });

  it('converts nested lists and task items', () => {
    expect(
      htmlToMarkdown(
        '<ul><li>a<ul><li>b</li></ul></li><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul><ol start="3"><li>x</li><li>y</li></ol>',
      ),
    ).toBe('- a\n  - b\n- [x] done\n- [ ] todo\n\n3. x\n4. y');
  });

  it('converts a quote, a rule and a table', () => {
    expect(htmlToMarkdown('<blockquote><p>q1</p><p>q2</p></blockquote><hr>')).toBe(
      '> q1\n>\n> q2\n\n---',
    );
    expect(
      htmlToMarkdown(
        '<table><tr><th>A</th><th>B</th></tr><tr><td>1 | 2</td><td><b>x</b></td></tr></table>',
      ),
    ).toBe('| A | B |\n| --- | --- |\n| 1 \\| 2 | **x** |');
  });

  it('converts links and images, dropping unsafe ones', () => {
    expect(
      htmlToMarkdown(
        '<p><a href="https://e.com/a b">site</a> <a href="https://e.com">https://e.com</a> <img src="https://e.com/i.png" alt="pic"> <img src="javascript:x" alt="bad"></p>',
      ),
    ).toBe('[site](https://e.com/a%20b) <https://e.com> ![pic](https://e.com/i.png) bad');
  });

  it('turns a dangerous link into text and runs nothing', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const md = htmlToMarkdown(
      '<p><a href="javascript:alert(1)">click</a><script>alert(2)</script><img src=x onerror="alert(3)"></p><style>p{}</style><!-- c --><b>ok</b>',
    );
    expect(md).toBe('click\n\n**ok**');
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('escapes markup characters in plain text', () => {
    expect(htmlToMarkdown('<p>2 * 3 _x_ [a]</p><p># not a heading</p><p>1. no</p><hr>')).toBe(
      '2 \\* 3 \\_x\\_ \\[a\\]\n\n\\# not a heading\n\n1\\. no\n\n---',
    );
  });

  it('does not leave trailing line breaks before a block boundary', () => {
    expect(htmlToMarkdown('<p><b>a</b><br></p><p>b</p>')).toBe('**a**\n\nb');
  });

  it('handles a Google Docs fragment', () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Bold</span><span> and plain</span></p><ul><li><span>item</span></li></ul></b>';
    expect(htmlToMarkdown(html)).toBe('**Bold** and plain\n\n- item');
  });

  it('keeps a Google Docs wrapper without formatting as plain', () => {
    expect(
      htmlToMarkdown('<b style="font-weight:normal" id="docs-internal-guid-2"><p>text</p></b>'),
    ).toBeNull();
  });
});
