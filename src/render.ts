import { Doc, Node, getById, findPath, nodeAt } from './outline';

export type ViewState = {
  doc: Doc;
  zoomId: string; // id of the node we're zoomed into; 'root' for top
  focusId: string | null; // node whose .text should have focus
  caretOffset: number | null; // caret position inside focused text (or null = end)
  selection: { anchorId: string; headId: string } | null;
  selectedIds: Set<string>; // derived from selection; populated by caller before render
};

export function render(state: ViewState, root: HTMLElement, breadcrumb: HTMLElement, title: HTMLElement) {
  const zoomNode = getById(state.doc.root, state.zoomId) ?? state.doc.root;

  // Breadcrumb
  breadcrumb.innerHTML = '';
  if (state.zoomId !== 'root') {
    const path = findPath(state.doc.root, state.zoomId) ?? [];
    const crumbs: { id: string; label: string }[] = [{ id: 'root', label: 'Home' }];
    for (let i = 0; i < path.length - 1; i++) {
      const n = nodeAt(state.doc.root, path.slice(0, i + 1));
      crumbs.push({ id: n.id, label: n.text || 'Untitled' });
    }
    crumbs.forEach((c, i) => {
      const a = document.createElement('a');
      a.textContent = c.label;
      a.dataset.zoom = c.id;
      breadcrumb.appendChild(a);
      if (i < crumbs.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '›';
        breadcrumb.appendChild(sep);
      }
    });
  }

  // Title (zoomed node's text, or empty placeholder for root)
  title.textContent = state.zoomId === 'root' ? '' : zoomNode.text;
  title.dataset.id = zoomNode.id;
  title.contentEditable = state.zoomId === 'root' ? 'false' : 'true';

  // Outline
  root.innerHTML = '';
  for (const child of zoomNode.children) {
    root.appendChild(renderNode(child, state.selectedIds));
  }

  // Restore focus (skip while multi-selection is active so text caret doesn't steal it).
  if (state.focusId && !state.selection) {
    const el = root.querySelector<HTMLElement>(`[data-id="${state.focusId}"] > .row > .text`);
    if (el) {
      placeCaret(el, state.caretOffset);
    } else if (title.dataset.id === state.focusId) {
      placeCaret(title, state.caretOffset);
    }
  }
}

function renderNode(n: Node, selectedIds: Set<string>): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'node';
  li.dataset.id = n.id;
  if (n.children.length) li.classList.add('has-children');
  if (n.collapsed) li.classList.add('collapsed');
  if (n.completed) li.classList.add('completed');

  const row = document.createElement('div');
  row.className = 'row';
  if (selectedIds.has(n.id)) row.classList.add('selected');

  const handle = document.createElement('div');
  handle.className = 'handle collapse';
  handle.textContent = '▾';
  handle.dataset.action = 'toggle-collapse';
  row.appendChild(handle);

  const bullet = document.createElement('div');
  bullet.className = 'bullet';
  bullet.dataset.action = 'zoom';
  row.appendChild(bullet);

  const text = document.createElement('div');
  text.className = 'text';
  text.contentEditable = 'true';
  text.spellcheck = true;
  text.textContent = n.text;
  row.appendChild(text);

  li.appendChild(row);

  if (n.children.length) {
    const ul = document.createElement('ul');
    for (const c of n.children) ul.appendChild(renderNode(c, selectedIds));
    li.appendChild(ul);
  }

  return li;
}

export function placeCaret(el: HTMLElement, offset: number | null) {
  el.focus();
  const range = document.createRange();
  const sel = window.getSelection();
  if (!sel) return;
  const textNode = el.firstChild;
  if (textNode && textNode.nodeType === 3 /* Node.TEXT_NODE */) {
    const len = textNode.textContent?.length ?? 0;
    const pos = offset === null ? len : Math.min(offset, len);
    range.setStart(textNode, pos);
    range.collapse(true);
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

export function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

export function isCaretAtEnd(el: HTMLElement): boolean {
  return caretOffset(el) === (el.textContent?.length ?? 0);
}

export function isCaretAtStart(el: HTMLElement): boolean {
  return caretOffset(el) === 0;
}
