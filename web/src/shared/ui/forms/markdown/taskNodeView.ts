import type { RefObject } from 'react';
import type { Node } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { editorSchema as schema } from '../../../lib/markdown/editorSchema.ts';

export function taskNodeView(
  node: Node,
  disabled: boolean | undefined,
  taskLabel: RefObject<string>,
) {
  const dom = document.createElement('li');
  const contentDOM = document.createElement('div');
  let checkbox: HTMLInputElement | null = null;
  if (node.attrs.checked != null) {
    dom.dataset.task = 'true';
    checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.contentEditable = 'false';
    checkbox.disabled = !!disabled;
    dom.append(checkbox);
  }
  dom.append(contentDOM);
  const update = (next: Node) => {
    if (next.type !== node.type || (next.attrs.checked != null) !== !!checkbox) return false;
    if (checkbox) {
      checkbox.checked = next.attrs.checked;
      const text = next.textContent.trim();
      checkbox.toggleAttribute('data-empty-task', !text);
      checkbox.setAttribute('aria-label', text || taskLabel.current);
    }
    return true;
  };
  update(node);
  return { dom, contentDOM, update };
}

export function taskClick(view: EditorView, event: Event, disabled: boolean | undefined) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return false;
  const item = input.closest('li[data-task]');
  if (!item) return false;
  const $pos = view.state.doc.resolve(view.posAtDOM(item, 0));
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type !== schema.nodes.list_item || node.attrs.checked == null) continue;
    if (!disabled) {
      view.dispatch(
        view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
          ...node.attrs,
          checked: !node.attrs.checked,
        }),
      );
      view.focus();
    } else event.preventDefault();
    return true;
  }
  return false;
}
