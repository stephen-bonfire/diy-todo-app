import {
  Doc, Node, newDoc, newNode, getById, findPath, nodeAt, parentOf,
  prevVisible, nextVisible, clone, flattenVisible, rangeBetween,
} from './outline';
import {
  ViewState, render, caretOffset, isCaretAtEnd, isCaretAtStart,
} from './render';
import { parseMarkdown, serializeMarkdown } from './markdown';

declare global {
  interface Window {
    api: {
      load: () => Promise<string | null>;
      save: (json: string) => Promise<void>;
      onToggleShortcuts: (cb: () => void) => void;
    };
  }
}

const outlineEl = document.getElementById('outline') as HTMLElement;
const breadcrumbEl = document.getElementById('breadcrumb') as HTMLElement;
const titleEl = document.getElementById('zoom-title') as HTMLElement;
const sidebarTreeEl = document.getElementById('sidebar-tree') as HTMLElement;
const sidebarHomeEl = document.getElementById('sidebar-home') as HTMLElement;

// Sidebar's collapsed state is independent of the main outline.
// Defaults to collapsed for any node we encounter for the first time.
const sidebarCollapsed = new Set<string>();
const sidebarSeen = new Set<string>();

let state: ViewState = {
  doc: newDoc(),
  zoomId: 'root',
  focusId: null,
  caretOffset: null,
  selection: null,
  selectedIds: new Set<string>(),
};

// --- selection helpers ---

function recomputeSelectedIds() {
  state.selectedIds = new Set<string>();
  if (!state.selection) return;
  const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;
  for (const n of rangeBetween(zoom, state.selection.anchorId, state.selection.headId)) {
    state.selectedIds.add(n.id);
  }
}

function clearSelection() {
  state.selection = null;
  state.selectedIds = new Set<string>();
}

function selectedNodes(): Node[] {
  if (!state.selection) return [];
  const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;
  return rangeBetween(zoom, state.selection.anchorId, state.selection.headId);
}

function setSelection(anchorId: string, headId: string) {
  state.selection = { anchorId, headId };
  recomputeSelectedIds();
}

function extendSelection(headId: string) {
  if (!state.selection) {
    const focus = state.focusId ?? headId;
    setSelection(focus, headId);
  } else {
    state.selection.headId = headId;
    recomputeSelectedIds();
  }
}

// --- undo/redo ---
const undoStack: { doc: Doc; zoomId: string; focusId: string | null; caretOffset: number | null }[] = [];
const redoStack: typeof undoStack = [];
const UNDO_LIMIT = 200;

function snapshot() {
  undoStack.push({
    doc: clone(state.doc),
    zoomId: state.zoomId,
    focusId: state.focusId,
    caretOffset: state.caretOffset,
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push({
    doc: clone(state.doc),
    zoomId: state.zoomId,
    focusId: state.focusId,
    caretOffset: state.caretOffset,
  });
  state.doc = prev.doc;
  state.zoomId = prev.zoomId;
  state.focusId = prev.focusId;
  state.caretOffset = prev.caretOffset;
  rerender();
  scheduleSave();
}

function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push({
    doc: clone(state.doc),
    zoomId: state.zoomId,
    focusId: state.focusId,
    caretOffset: state.caretOffset,
  });
  state.doc = next.doc;
  state.zoomId = next.zoomId;
  state.focusId = next.focusId;
  state.caretOffset = next.caretOffset;
  rerender();
  scheduleSave();
}

// --- persistence ---
let saveTimer: number | null = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    window.api.save(JSON.stringify(state.doc)).catch(console.error);
  }, 250);
}

async function loadFromDisk() {
  try {
    const raw = await window.api.load();
    if (raw) {
      const parsed = JSON.parse(raw) as Doc;
      if (parsed && parsed.root) {
        state.doc = parsed;
        if (state.doc.root.children.length === 0) {
          state.doc.root.children.push(newNode(''));
        }
        const first = state.doc.root.children[0];
        state.focusId = first.id;
      }
    } else {
      const first = state.doc.root.children[0];
      state.focusId = first.id;
    }
  } catch (e) {
    console.error('load failed', e);
  }
  rerender();
}

// --- rendering ---
function rerender() {
  render(state, outlineEl, breadcrumbEl, titleEl);
  renderSidebar();
}

function renderSidebar() {
  sidebarTreeEl.innerHTML = '';
  for (const child of state.doc.root.children) {
    if (!child.text.trim()) continue;
    sidebarTreeEl.appendChild(renderSidebarNode(child));
  }
  sidebarHomeEl.classList.toggle('active', state.zoomId === 'root');
}

function renderSidebarNode(n: Node): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 's-item';
  li.dataset.id = n.id;
  const hasChildren = n.children.some((c) => c.text.trim());
  // First time we see this node with children, default it to collapsed.
  if (hasChildren && !sidebarSeen.has(n.id)) {
    sidebarCollapsed.add(n.id);
  }
  sidebarSeen.add(n.id);
  if (hasChildren && sidebarCollapsed.has(n.id)) li.classList.add('collapsed');

  const row = document.createElement('div');
  row.className = 's-row';
  if (n.id === state.zoomId) row.classList.add('active');
  row.dataset.id = n.id;

  const caret = document.createElement('span');
  caret.className = 's-caret' + (hasChildren ? '' : ' empty');
  caret.textContent = '▾';
  caret.dataset.action = 's-toggle';
  row.appendChild(caret);

  const label = document.createElement('span');
  label.className = 's-label';
  label.textContent = n.text || 'Untitled';
  label.dataset.action = 's-zoom';
  row.appendChild(label);

  li.appendChild(row);

  const visibleChildren = n.children.filter((c) => c.text.trim());
  if (visibleChildren.length) {
    const ul = document.createElement('ul');
    for (const c of visibleChildren) ul.appendChild(renderSidebarNode(c));
    li.appendChild(ul);
  }
  return li;
}

// --- helpers tied to current state ---
function captureCaret() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const el = sel.anchorNode?.parentElement?.closest('.text, #zoom-title') as HTMLElement | null;
  if (!el) return;
  const id = (el.closest('.node') as HTMLElement | null)?.dataset.id ?? titleEl.dataset.id;
  if (!id) return;
  state.focusId = id;
  state.caretOffset = caretOffset(el);
}

function focusedNodeId(): string | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return null;
  if (active === titleEl) return titleEl.dataset.id ?? null;
  const li = active.closest('.node') as HTMLElement | null;
  return li?.dataset.id ?? null;
}

function focusedTextEl(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return null;
  if (active.classList.contains('text') || active.id === 'zoom-title') return active;
  return null;
}

// --- tree mutations ---

function insertSiblingAfter(parent: Node, index: number, node: Node) {
  parent.children.splice(index + 1, 0, node);
}

function insertFirstChild(parent: Node, node: Node) {
  parent.children.unshift(node);
}

function handleEnter(currentId: string, textEl: HTMLElement) {
  const path = findPath(state.doc.root, currentId);
  if (!path) return;
  const current = nodeAt(state.doc.root, path);
  const p = parentOf(state.doc.root, path);
  if (!p) return;

  const offset = caretOffset(textEl);
  const fullText = textEl.textContent ?? '';
  const before = fullText.slice(0, offset);
  const after = fullText.slice(offset);

  snapshot();

  // Context-aware: if current has visible children and caret at end, insert as first child.
  const hasVisibleChildren = current.children.length > 0 && !current.collapsed;
  if (hasVisibleChildren && offset === fullText.length) {
    const newN = newNode('');
    insertFirstChild(current, newN);
    state.focusId = newN.id;
    state.caretOffset = 0;
  } else if (offset === 0 && fullText.length > 0) {
    // Caret at start of non-empty bullet: insert empty bullet ABOVE; keep caret on current.
    const newN = newNode('');
    p.parent.children.splice(p.index, 0, newN);
    state.focusId = newN.id;
    state.caretOffset = 0;
  } else {
    // Split text: text after caret becomes a new sibling below.
    current.text = before;
    const newN = newNode(after);
    insertSiblingAfter(p.parent, p.index, newN);
    state.focusId = newN.id;
    state.caretOffset = 0;
  }
  rerender();
  scheduleSave();
}

function handleIndent(currentId: string) {
  const path = findPath(state.doc.root, currentId);
  if (!path) return;
  const p = parentOf(state.doc.root, path);
  if (!p) return;
  if (p.index === 0) return; // no previous sibling to nest under
  snapshot();
  const node = p.parent.children.splice(p.index, 1)[0];
  const newParent = p.parent.children[p.index - 1];
  newParent.collapsed = false;
  newParent.children.push(node);
  rerender();
  scheduleSave();
}

function handleOutdent(currentId: string) {
  const path = findPath(state.doc.root, currentId);
  if (!path || path.length < 2) return;
  const p = parentOf(state.doc.root, path)!;
  const grand = parentOf(state.doc.root, path.slice(0, -1));
  if (!grand) return;
  snapshot();
  const node = p.parent.children.splice(p.index, 1)[0];
  grand.parent.children.splice(grand.index + 1, 0, node);
  rerender();
  scheduleSave();
}

function handleMoveUp(currentId: string) {
  const path = findPath(state.doc.root, currentId);
  if (!path) return;
  const p = parentOf(state.doc.root, path);
  if (!p || p.index === 0) return;
  snapshot();
  const node = p.parent.children.splice(p.index, 1)[0];
  p.parent.children.splice(p.index - 1, 0, node);
  rerender();
  scheduleSave();
}

function handleMoveDown(currentId: string) {
  const path = findPath(state.doc.root, currentId);
  if (!path) return;
  const p = parentOf(state.doc.root, path);
  if (!p || p.index >= p.parent.children.length - 1) return;
  snapshot();
  const node = p.parent.children.splice(p.index, 1)[0];
  p.parent.children.splice(p.index + 1, 0, node);
  rerender();
  scheduleSave();
}

function handleBackspaceMerge(currentId: string, textEl: HTMLElement): boolean {
  // Only merge when caret is at start.
  if (!isCaretAtStart(textEl)) return false;
  const path = findPath(state.doc.root, currentId);
  if (!path) return false;
  const current = nodeAt(state.doc.root, path);
  const p = parentOf(state.doc.root, path)!;

  // Find previous visible node
  const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;
  const prev = prevVisible(zoom, currentId);
  if (!prev) return false;

  // Don't merge if current has children (gets messy); only allow when empty children.
  if (current.children.length > 0) return false;

  snapshot();
  const prevLen = prev.text.length;
  prev.text = prev.text + current.text;
  // Remove current
  p.parent.children.splice(p.index, 1);
  state.focusId = prev.id;
  state.caretOffset = prevLen;
  rerender();
  scheduleSave();
  return true;
}

function handleDeleteBullet(currentId: string) {
  const path = findPath(state.doc.root, currentId);
  if (!path) return;
  const p = parentOf(state.doc.root, path)!;
  // Don't allow deleting the currently zoomed node itself.
  if (currentId === state.zoomId) return;

  // Pick where focus should go after deletion: previous visible, else next, else parent.
  const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;
  const prev = prevVisible(zoom, currentId);
  const next = nextVisible(zoom, currentId);

  snapshot();
  p.parent.children.splice(p.index, 1);

  // Ensure the doc never ends up with zero children at the zoom root.
  if (zoom.children.length === 0) {
    const fresh = newNode('');
    zoom.children.push(fresh);
    state.focusId = fresh.id;
    state.caretOffset = 0;
  } else {
    const target = prev ?? next ?? p.parent;
    state.focusId = target.id;
    state.caretOffset = null;
  }
  rerender();
  scheduleSave();
}

function handleToggleComplete(currentId: string) {
  const n = getById(state.doc.root, currentId);
  if (!n) return;
  snapshot();
  n.completed = !n.completed;
  rerender();
  scheduleSave();
}

function handleToggleCollapse(currentId: string) {
  const n = getById(state.doc.root, currentId);
  if (!n || n.children.length === 0) return;
  snapshot();
  n.collapsed = !n.collapsed;
  rerender();
  scheduleSave();
}

function handleToggleCollapseRecursive(currentId: string) {
  const n = getById(state.doc.root, currentId);
  if (!n || n.children.length === 0) return;
  const withKids: Node[] = [];
  const walk = (x: Node) => {
    if (x.children.length > 0) withKids.push(x);
    for (const c of x.children) walk(c);
  };
  walk(n);
  if (withKids.length === 0) return;
  const allCollapsed = withKids.every((x) => x.collapsed);
  snapshot();
  for (const x of withKids) x.collapsed = !allCollapsed;
  rerender();
  scheduleSave();
}

function scrollSelectionIntoView() {
  if (!state.selection) return;
  const el = outlineEl.querySelector<HTMLElement>(`[data-id="${state.selection.headId}"] > .row`);
  el?.scrollIntoView({ block: 'nearest' });
}

// --- multi-selection bulk operations ---

function sameParent(nodes: Node[]): { parent: Node; indices: number[] } | null {
  if (nodes.length === 0) return null;
  const firstPath = findPath(state.doc.root, nodes[0].id);
  if (!firstPath) return null;
  const parent = parentOf(state.doc.root, firstPath)!.parent;
  const indices: number[] = [];
  for (const n of nodes) {
    const idx = parent.children.indexOf(n);
    if (idx < 0) return null;
    indices.push(idx);
  }
  // Indices must be contiguous and ascending.
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return null;
  }
  return { parent, indices };
}

function bulkDelete() {
  const nodes = selectedNodes();
  if (nodes.length === 0) return;
  // Pick focus target: visible node just before the first selected, else after the last.
  const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;
  const flat = flattenVisible(zoom);
  const firstIdx = flat.findIndex((n) => n.id === nodes[0].id);
  const lastIdx = flat.findIndex((n) => n.id === nodes[nodes.length - 1].id);
  const focusTarget = flat[firstIdx - 1] ?? flat[lastIdx + 1] ?? null;

  snapshot();
  // Delete each — they may not share a parent; remove each from its own parent.
  // Process in reverse document order so index shifts inside the same parent don't bite.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const path = findPath(state.doc.root, nodes[i].id);
    if (!path) continue;
    const p = parentOf(state.doc.root, path)!;
    p.parent.children.splice(p.index, 1);
  }
  // Ensure zoom root still has at least one child.
  if (zoom.children.length === 0) {
    const fresh = newNode('');
    zoom.children.push(fresh);
    state.focusId = fresh.id;
  } else {
    state.focusId = focusTarget?.id ?? zoom.children[0].id;
  }
  state.caretOffset = null;
  clearSelection();
  rerender();
  scheduleSave();
}

function bulkToggleComplete() {
  const nodes = selectedNodes();
  if (nodes.length === 0) return;
  const allDone = nodes.every((n) => n.completed);
  snapshot();
  for (const n of nodes) n.completed = !allDone;
  rerender();
  scheduleSave();
}

function bulkToggleCollapse() {
  const nodes = selectedNodes().filter((n) => n.children.length > 0);
  if (nodes.length === 0) return;
  const allCollapsed = nodes.every((n) => n.collapsed);
  snapshot();
  for (const n of nodes) n.collapsed = !allCollapsed;
  rerender();
  scheduleSave();
}

function bulkMove(dir: -1 | 1) {
  const nodes = selectedNodes();
  const block = sameParent(nodes);
  if (!block) return; // bail if selection isn't a same-parent contiguous block
  const { parent, indices } = block;
  const first = indices[0];
  const last = indices[indices.length - 1];
  if (dir === -1 && first === 0) return;
  if (dir === 1 && last === parent.children.length - 1) return;
  snapshot();
  const removed = parent.children.splice(first, last - first + 1);
  const newPos = dir === -1 ? first - 1 : first + 1;
  parent.children.splice(newPos, 0, ...removed);
  rerender();
  scheduleSave();
}

function bulkIndent() {
  const nodes = selectedNodes();
  const block = sameParent(nodes);
  if (!block) return;
  const { parent, indices } = block;
  if (indices[0] === 0) return;
  snapshot();
  const newParent = parent.children[indices[0] - 1];
  newParent.collapsed = false;
  const removed = parent.children.splice(indices[0], indices.length);
  newParent.children.push(...removed);
  rerender();
  scheduleSave();
}

function bulkOutdent() {
  const nodes = selectedNodes();
  const block = sameParent(nodes);
  if (!block) return;
  const firstPath = findPath(state.doc.root, nodes[0].id);
  if (!firstPath || firstPath.length < 2) return;
  const grand = parentOf(state.doc.root, firstPath.slice(0, -1));
  if (!grand) return;
  const { parent, indices } = block;
  snapshot();
  const removed = parent.children.splice(indices[0], indices.length);
  grand.parent.children.splice(grand.index + 1, 0, ...removed);
  rerender();
  scheduleSave();
}

async function bulkCopyMarkdown() {
  const nodes = selectedNodes();
  if (nodes.length === 0) return;
  const md = nodes.map((n) => serializeMarkdown(n)).join('\n');
  try {
    await navigator.clipboard.writeText(md);
  } catch (err) {
    console.error('clipboard write failed', err);
  }
}

function zoomTo(id: string) {
  if (id === state.zoomId) return;
  snapshot();
  state.zoomId = id;
  const target = getById(state.doc.root, id) ?? state.doc.root;
  if (id !== 'root') {
    state.focusId = id;
    state.caretOffset = null;
  } else if (target.children.length) {
    state.focusId = target.children[0].id;
    state.caretOffset = null;
  }
  rerender();
  scheduleSave();
}

function zoomOut() {
  if (state.zoomId === 'root') return;
  const path = findPath(state.doc.root, state.zoomId);
  if (!path || path.length <= 1) {
    zoomTo('root');
    return;
  }
  const parentPath = path.slice(0, -1);
  const parent = nodeAt(state.doc.root, parentPath);
  zoomTo(parent.id);
}

function moveCursor(dir: 1 | -1) {
  const id = focusedNodeId();
  if (!id) return;
  const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;

  // If focus is in the zoom title (the zoomed-into node itself), arrow-down enters its
  // first visible child; arrow-up does nothing (can't go above the title).
  if (id === state.zoomId && state.zoomId !== 'root') {
    if (dir === 1 && zoom.children.length > 0 && !zoom.collapsed) {
      state.focusId = zoom.children[0].id;
      state.caretOffset = null;
      rerender();
    }
    return;
  }

  const target = dir === -1 ? prevVisible(zoom, id) : nextVisible(zoom, id);
  if (!target) {
    // At the top of the outline: jump up into the title (if we're zoomed in).
    if (dir === -1 && state.zoomId !== 'root') {
      state.focusId = state.zoomId;
      state.caretOffset = null;
      rerender();
    }
    return;
  }
  state.focusId = target.id;
  state.caretOffset = null;
  rerender();
}

// --- event wiring ---

// Paste: if pasted text looks like a markdown bulleted list, splice it in as bullets.
function looksLikeOutline(text: string): boolean {
  // At least one line that starts with a bullet marker (possibly indented).
  return /(^|\n)\s*(?:[-*+]|\d+\.)\s+\S/.test(text);
}

document.addEventListener('paste', (e) => {
  const target = e.target as HTMLElement;
  // Only handle pastes inside an outline bullet's text element.
  if (!target.classList?.contains('text')) return;
  const li = target.closest('.node') as HTMLElement | null;
  if (!li) return;

  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (!text || !looksLikeOutline(text)) return; // let default paste handle plain text

  e.preventDefault();
  const id = li.dataset.id!;
  const current = getById(state.doc.root, id);
  if (!current) return;

  const roots = parseMarkdown(text);
  if (roots.length === 0) return;

  snapshot();

  const isEmpty = current.text === '' && current.children.length === 0;
  if (isEmpty && roots.length === 1) {
    // Absorb the single root into the current bullet.
    current.text = roots[0].text;
    current.children = roots[0].children;
    current.completed = roots[0].completed;
    state.focusId = current.id;
    state.caretOffset = current.text.length;
  } else if (isEmpty) {
    // Absorb first root into current, splice remaining roots as siblings after.
    current.text = roots[0].text;
    current.children = roots[0].children;
    current.completed = roots[0].completed;
    const p = parentOf(state.doc.root, findPath(state.doc.root, id)!)!;
    for (let i = 1; i < roots.length; i++) {
      p.parent.children.splice(p.index + i, 0, roots[i]);
    }
    state.focusId = current.id;
    state.caretOffset = current.text.length;
  } else {
    // Append parsed roots as children of current.
    current.collapsed = false;
    current.children.push(...roots);
    state.focusId = current.id;
    state.caretOffset = current.text.length;
  }

  rerender();
  scheduleSave();
});

// Copy current bullet + subtree as markdown (Cmd+Shift+C).
async function copySubtreeMarkdown(currentId: string) {
  const n = getById(state.doc.root, currentId);
  if (!n) return;
  const md = serializeMarkdown(n);
  try {
    await navigator.clipboard.writeText(md);
  } catch (err) {
    console.error('clipboard write failed', err);
  }
}

// Text input → update model (no snapshot per keystroke; we snapshot at coarser points).
let inputDebounce: number | null = null;
let lastInputId: string | null = null;
outlineEl.addEventListener('input', (e) => {
  const t = e.target as HTMLElement;
  if (!t.classList.contains('text')) return;
  const li = t.closest('.node') as HTMLElement;
  const id = li.dataset.id!;
  const n = getById(state.doc.root, id);
  if (!n) return;
  // Snapshot once per "typing burst" per node.
  if (lastInputId !== id) {
    snapshot();
    lastInputId = id;
  }
  n.text = t.textContent ?? '';
  if (inputDebounce) clearTimeout(inputDebounce);
  inputDebounce = window.setTimeout(() => { lastInputId = null; }, 600);
  scheduleSave();
});

titleEl.addEventListener('input', () => {
  const id = titleEl.dataset.id;
  if (!id || id === 'root') return;
  const n = getById(state.doc.root, id);
  if (!n) return;
  if (lastInputId !== id) { snapshot(); lastInputId = id; }
  n.text = titleEl.textContent ?? '';
  if (inputDebounce) clearTimeout(inputDebounce);
  inputDebounce = window.setTimeout(() => { lastInputId = null; }, 600);
  scheduleSave();
});

// Click handlers: bullet zoom, collapse toggle, breadcrumb
document.addEventListener('click', (e) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const target = e.target as HTMLElement;
  const action = target.dataset.action;
  const li = target.closest('.node') as HTMLElement | null;

  if (action === 'zoom' && li) {
    zoomTo(li.dataset.id!);
    e.preventDefault();
    return;
  }
  if (action === 'toggle-collapse' && li) {
    handleToggleCollapse(li.dataset.id!);
    e.preventDefault();
    return;
  }
  const crumb = target.closest('#breadcrumb a') as HTMLElement | null;
  if (crumb && crumb.dataset.zoom) {
    zoomTo(crumb.dataset.zoom);
    e.preventDefault();
    return;
  }

  // Sidebar
  if (target.id === 'sidebar-home') {
    zoomTo('root');
    e.preventDefault();
    return;
  }
  if (action === 's-toggle') {
    const sli = target.closest('.s-item') as HTMLElement | null;
    if (sli) {
      const id = sli.dataset.id!;
      if (sidebarCollapsed.has(id)) sidebarCollapsed.delete(id);
      else sidebarCollapsed.add(id);
      renderSidebar();
    }
    e.preventDefault();
    return;
  }
  if (action === 's-zoom') {
    const sli = target.closest('.s-item') as HTMLElement | null;
    if (sli) {
      zoomTo(sli.dataset.id!);
    }
    e.preventDefault();
    return;
  }
});

// --- Drag-to-reorder bullets ---
const dropIndicator = document.getElementById('drop-indicator') as HTMLElement;
const DEPTH_PX = 26; // matches `.outline ul` indent (margin-left 7 + padding-left 19)
const BULLET_OFFSET_PX = 28; // .handle width (22) + flex gap (6) — distance from .row left to bullet

type DragTarget = {
  gap: number;
  depth: number;
  parent: Node;
  index: number;
  // The list of valid (non-source) rows the gap is computed against; used by indicator.
  validRows: HTMLElement[];
};
type DragState = {
  sourceIds: string[];
  startX: number;
  startY: number;
  active: boolean; // true once threshold passed
  target: DragTarget | null;
};
let dragState: DragState | null = null;

function visibleRowEls(): HTMLElement[] {
  return Array.from(outlineEl.querySelectorAll<HTMLElement>('li.node')).filter((li) => {
    // Skip nodes inside collapsed ancestors (they're not visible).
    let p = li.parentElement;
    while (p && p !== outlineEl) {
      if (p.tagName === 'LI' && p.classList.contains('collapsed')) return false;
      p = p.parentElement;
    }
    return true;
  });
}

function depthOf(li: HTMLElement): number {
  // Walks from this li's parent up to outlineEl, counting nested <ul>s.
  // Top-level li → 0; one level deep → 1; etc.
  let depth = 0;
  let p = li.parentElement;
  while (p && p !== outlineEl) {
    if (p.tagName === 'UL') depth++;
    p = p.parentElement;
  }
  return depth;
}

function findBulletXForDepth(depth: number, refRow: HTMLElement | null): number {
  // Compute the screen X of where the bullet sits at a given depth, using a reference row.
  if (!refRow) return outlineEl.getBoundingClientRect().left;
  const refDepth = depthOf(refRow.closest('li.node') as HTMLElement);
  const refLeft = refRow.getBoundingClientRect().left;
  return refLeft + (depth - refDepth) * DEPTH_PX;
}

function computeDropTarget(clientX: number, clientY: number): DragTarget | null {
  if (!dragState) return null;
  const rows = visibleRowEls();
  if (rows.length === 0) return null;

  // Gap N is "before row N"; gap rows.length is "after last". Always include all
  // visible rows so the indicator tracks the cursor smoothly.
  // Use each row's .row child (just the bullet line) for Y — the LI itself
  // wraps its whole subtree, which would give the wrong midpoint.
  const rowRects = rows.map((li) => {
    const rowEl = li.querySelector(':scope > .row') as HTMLElement;
    return rowEl.getBoundingClientRect();
  });

  let gap = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const mid = rowRects[i].top + rowRects[i].height / 2;
    if (clientY < mid) { gap = i; break; }
  }

  const sourceSet = new Set(dragState.sourceIds);
  const isInSourceSubtree = (li: HTMLElement): boolean => {
    let cur: HTMLElement | null = li;
    while (cur && cur !== outlineEl) {
      if (cur.tagName === 'LI' && sourceSet.has(cur.dataset.id!)) return true;
      cur = cur.parentElement as HTMLElement | null;
    }
    return false;
  };

  // The visible row immediately above the gap that is NOT in the source subtree
  // — this anchors where we'll insert in the data model.
  let anchorIdx = gap - 1;
  while (anchorIdx >= 0 && isInSourceSubtree(rows[anchorIdx])) anchorIdx--;
  // And the next non-source row below the gap, for min-depth constraint.
  let belowIdx = gap;
  while (belowIdx < rows.length && isInSourceSubtree(rows[belowIdx])) belowIdx++;
  const anchorRow = anchorIdx >= 0 ? rows[anchorIdx] : null;
  const belowRow = belowIdx < rows.length ? rows[belowIdx] : null;

  // Valid depth range based on actual (non-source) neighbors.
  const anchorDepth = anchorRow ? depthOf(anchorRow) : -1;
  const belowDepth = belowRow ? depthOf(belowRow) : 0;
  const maxDepth = anchorRow ? anchorDepth + 1 : 0;
  const minDepth = belowRow ? belowDepth : 0;
  const lo = Math.min(minDepth, maxDepth);
  const hi = Math.max(minDepth, maxDepth);

  // Pick depth from mouse X. Use the visible row at the gap (whatever it is) as reference.
  const visualRef = rows[Math.max(0, Math.min(rows.length - 1, gap > 0 ? gap - 1 : 0))];
  const refDepth = depthOf(visualRef);
  const refLeft = visualRef.getBoundingClientRect().left;
  let chosen = Math.round(refDepth + (clientX - refLeft) / DEPTH_PX);
  chosen = Math.max(lo, Math.min(hi, chosen));

  // Translate (anchorRow, chosen depth) → (parent node, insert index).
  let parent: Node;
  let index: number;
  if (!anchorRow) {
    const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;
    parent = zoom;
    index = 0;
  } else {
    const anchorNode = getById(state.doc.root, anchorRow.dataset.id!)!;
    if (chosen > anchorDepth) {
      parent = anchorNode;
      index = 0;
    } else if (chosen === anchorDepth) {
      const path = findPath(state.doc.root, anchorNode.id)!;
      const p = parentOf(state.doc.root, path)!;
      parent = p.parent;
      index = p.index + 1;
    } else {
      let cur = anchorNode;
      let curDepth = anchorDepth;
      while (curDepth > chosen) {
        const path = findPath(state.doc.root, cur.id)!;
        const p = parentOf(state.doc.root, path)!;
        cur = p.parent;
        curDepth--;
      }
      const path = findPath(state.doc.root, cur.id);
      if (!path || path.length === 0) {
        const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;
        parent = zoom;
        index = zoom.children.length;
      } else {
        const p = parentOf(state.doc.root, path)!;
        parent = p.parent;
        index = p.index + 1;
      }
    }
  }

  return { gap, depth: chosen, parent, index, validRows: rows };
}

function showDropIndicator(target: DragTarget) {
  const rows = visibleRowEls();
  if (rows.length === 0) { hideDropIndicator(); return; }

  // Compute gap Y from .row bounding rects (NOT the LI, which includes children).
  const rowRects = rows.map((li) => (li.querySelector(':scope > .row') as HTMLElement).getBoundingClientRect());
  let top: number;
  if (target.gap === 0) {
    top = rowRects[0].top;
  } else if (target.gap >= rows.length) {
    top = rowRects[rowRects.length - 1].bottom;
  } else {
    top = (rowRects[target.gap - 1].bottom + rowRects[target.gap].top) / 2;
  }

  // X reference: the .row immediately above the gap (or below if at the top).
  const refIdx = target.gap > 0 ? target.gap - 1 : 0;
  const refLi = rows[refIdx];
  const refRow = refLi.querySelector(':scope > .row') as HTMLElement;
  const refDepth = depthOf(refLi);
  const refLeft = refRow.getBoundingClientRect().left;
  const left = refLeft + (target.depth - refDepth) * DEPTH_PX + BULLET_OFFSET_PX;

  const outlineRect = outlineEl.getBoundingClientRect();
  dropIndicator.style.top = `${top - 1}px`;
  dropIndicator.style.left = `${left}px`;
  dropIndicator.style.width = `${Math.max(40, outlineRect.right - left - 12)}px`;
  dropIndicator.classList.remove('hidden');
}

function hideDropIndicator() {
  dropIndicator.classList.add('hidden');
}

function executeDrop(target: NonNullable<DragState['target']>, sourceIds: string[]) {

  // Safety: don't allow dropping into source subtree.
  let parentCheck: Node | null = target.parent;
  while (parentCheck) {
    if (sourceIds.includes(parentCheck.id)) return;
    const path = findPath(state.doc.root, parentCheck.id);
    if (!path || path.length === 0) break;
    parentCheck = parentOf(state.doc.root, path)!.parent;
  }

  // Collect source nodes (in document order) and remove them.
  snapshot();
  const sources: Node[] = sourceIds.map((id) => getById(state.doc.root, id)!).filter(Boolean);

  // We need to be careful when removing nodes whose positions overlap with the target.
  // Strategy: detach all sources first (storing parent+index of each), then insert at target.
  // Because target.index was computed pre-removal, we need to adjust it if removals shift it.
  const removals: { parent: Node; index: number }[] = [];
  for (const n of sources) {
    const path = findPath(state.doc.root, n.id);
    if (!path) continue;
    removals.push(parentOf(state.doc.root, path)!);
  }

  // Sort removals by parent identity then descending index so splices are stable.
  // Group by parent.
  const byParent = new Map<Node, number[]>();
  removals.forEach((r) => {
    if (!byParent.has(r.parent)) byParent.set(r.parent, []);
    byParent.get(r.parent)!.push(r.index);
  });

  // Detach each — but first, adjust target.index if removals from the target.parent come before target.index.
  let adjustedTargetIndex = target.index;
  if (byParent.has(target.parent)) {
    const indices = byParent.get(target.parent)!;
    for (const i of indices) {
      if (i < adjustedTargetIndex) adjustedTargetIndex--;
    }
  }

  // Now splice out (highest index first within each parent).
  byParent.forEach((idxs, parent) => {
    idxs.sort((a, b) => b - a);
    for (const i of idxs) parent.children.splice(i, 1);
  });

  // Insert sources at target.
  target.parent.children.splice(adjustedTargetIndex, 0, ...sources);
  if (target.parent !== state.doc.root) target.parent.collapsed = false;

  // Keep selection on moved nodes.
  if (sources.length > 1) {
    setSelection(sources[0].id, sources[sources.length - 1].id);
  } else {
    clearSelection();
    state.focusId = sources[0].id;
    state.caretOffset = null;
  }

  rerender();
  scheduleSave();
}

// --- Mouse drag-select ---
let dragOrigin: { id: string; x: number; y: number } | null = null;
let dragging = false;

function rowIdAt(target: EventTarget | null): string | null {
  const el = target as HTMLElement | null;
  const li = el?.closest('.node') as HTMLElement | null;
  return li?.dataset.id ?? null;
}

outlineEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const id = rowIdAt(e.target);
  if (!id) return;

  // Bullet drag-to-reorder: starts on .bullet element.
  const targetEl = e.target as HTMLElement;
  if (targetEl.classList.contains('bullet')) {
    const sourceIds = state.selectedIds.has(id)
      ? Array.from(state.selectedIds)
      : [id];
    // Sort sourceIds by document order
    const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;
    const flat = flattenVisible(zoom);
    sourceIds.sort((a, b) => flat.findIndex((n) => n.id === a) - flat.findIndex((n) => n.id === b));

    dragState = {
      sourceIds,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      target: null,
    };
    e.preventDefault();
    return;
  }

  // Shift+click: extend selection immediately, no drag needed.
  if (e.shiftKey) {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur();
    window.getSelection()?.removeAllRanges();
    extendSelection(id);
    rerender();
    return;
  }
  dragOrigin = { id, x: e.clientX, y: e.clientY };
  dragging = false;
});

// Global mousemove for bullet drag-to-reorder.
document.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  if (!dragState.active) {
    const moved = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);
    if (moved < 4) return;
    dragState.active = true;
    document.body.classList.add('dragging-rows');
    (document.activeElement as HTMLElement | null)?.blur();
    // Mark source rows
    for (const sid of dragState.sourceIds) {
      const li = outlineEl.querySelector<HTMLElement>(`[data-id="${sid}"]`);
      li?.querySelector('.row')?.classList.add('drag-source');
    }
  }
  const target = computeDropTarget(e.clientX, e.clientY);
  dragState.target = target;
  if (target) showDropIndicator(target);
  else hideDropIndicator();
});

let suppressNextClick = false;
document.addEventListener('mouseup', () => {
  if (!dragState) return;
  const ds = dragState;
  dragState = null;
  document.body.classList.remove('dragging-rows');
  outlineEl.querySelectorAll('.row.drag-source').forEach((el) => el.classList.remove('drag-source'));
  hideDropIndicator();
  if (ds.active) {
    suppressNextClick = true;
    if (ds.target) executeDrop(ds.target, ds.sourceIds);
  }
});

outlineEl.addEventListener('mousemove', (e) => {
  if (!dragOrigin) return;
  const id = rowIdAt(e.target);
  if (!id) return;
  const moved = Math.hypot(e.clientX - dragOrigin.x, e.clientY - dragOrigin.y);
  if (!dragging) {
    // Enter drag-select mode when crossing into a different row, or moving > threshold.
    if (id !== dragOrigin.id || moved > 4) {
      dragging = true;
      document.body.classList.add('dragging-select');
      (document.activeElement as HTMLElement | null)?.blur();
      window.getSelection()?.removeAllRanges();
      setSelection(dragOrigin.id, id);
      rerender();
    }
    return;
  }
  e.preventDefault();
  if (state.selection && state.selection.headId !== id) {
    state.selection.headId = id;
    recomputeSelectedIds();
    rerender();
  }
});

document.addEventListener('mouseup', () => {
  if (dragging) {
    document.body.classList.remove('dragging-select');
  }
  dragOrigin = null;
  dragging = false;
});

// Clicking on an unselected text/area clears selection (without a full rerender,
// so the click can still place a caret on the original DOM element).
document.addEventListener('mousedown', (e) => {
  if (e.shiftKey) return;
  if (!state.selection) return;
  const id = rowIdAt(e.target);
  if (id && state.selectedIds.has(id)) return; // click inside selection → keep
  clearSelection();
  outlineEl.querySelectorAll('.row.selected').forEach((el) => el.classList.remove('selected'));
}, true);

// --- Shortcuts overlay ---
const shortcutsOverlay = document.getElementById('shortcuts-overlay') as HTMLElement;
function toggleShortcutsOverlay(show?: boolean) {
  const next = show ?? shortcutsOverlay.classList.contains('hidden');
  shortcutsOverlay.classList.toggle('hidden', !next);
}
shortcutsOverlay.addEventListener('click', (e) => {
  // Click on the dim backdrop (not the modal itself) closes.
  if (e.target === shortcutsOverlay) toggleShortcutsOverlay(false);
});
try { window.api.onToggleShortcuts?.(() => toggleShortcutsOverlay()); } catch { /* preload not loaded yet */ }
document.getElementById('help-button')?.addEventListener('click', () => toggleShortcutsOverlay());

// Keyboard — capture phase so we beat contenteditable native handling (esp. for Cmd+Arrow).
document.addEventListener('keydown', (e) => {
  const meta = e.metaKey;
  const shift = e.shiftKey;
  const textEl = focusedTextEl();
  const id = focusedNodeId();

  // Toggle shortcuts overlay: Cmd+/
  if (meta && (e.code === 'Slash' || e.key === '/')) {
    e.preventDefault();
    e.stopPropagation();
    toggleShortcutsOverlay();
    return;
  }
  // Esc closes the overlay if open (handled before single-bullet logic so it always works).
  if (e.key === 'Escape' && !shortcutsOverlay.classList.contains('hidden')) {
    e.preventDefault();
    toggleShortcutsOverlay(false);
    return;
  }

  // Undo / Redo (global)
  if (meta && !shift && e.key === 'z') {
    e.preventDefault();
    captureCaret();
    undo();
    return;
  }
  if (meta && (e.key === 'Z' || (shift && e.key === 'z'))) {
    e.preventDefault();
    redo();
    return;
  }

  // --- Multi-selection branch ---
  if (state.selection) {
    if (e.key === 'Escape') { e.preventDefault(); clearSelection(); rerender(); return; }

    // Cmd shortcuts FIRST so meta+arrow isn't swallowed by the shift+arrow branch.
    if (meta && e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); bulkMove(-1); scrollSelectionIntoView(); return; }
    if (meta && e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); bulkMove(1); scrollSelectionIntoView(); return; }
    if (meta && shift && e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); bulkDelete(); return; }
    if (meta && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); bulkToggleComplete(); return; }
    if (meta && !shift && e.key === '.') { e.preventDefault(); e.stopPropagation(); bulkToggleCollapse(); return; }
    if (meta && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); e.stopPropagation(); bulkCopyMarkdown(); return; }
    if (meta && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); e.stopPropagation(); bulkCopyMarkdown().then(() => bulkDelete()); return; }

    // Extend selection with Shift+ArrowUp/Down
    if (shift && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;
      const head = state.selection.headId;
      const target = e.key === 'ArrowUp' ? prevVisible(zoom, head) : nextVisible(zoom, head);
      if (target) {
        state.selection.headId = target.id;
        recomputeSelectedIds();
        rerender();
        scrollSelectionIntoView();
      }
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); bulkDelete(); return; }
    if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); if (shift) bulkOutdent(); else bulkIndent(); scrollSelectionIntoView(); return; }

    // Modifier-only keypresses (Cmd/Shift/Alt/Ctrl held alone) are no-ops — don't touch selection.
    if (e.key === 'Meta' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control') {
      return;
    }

    // Plain arrow (no shift): collapse selection to head and fall through to single-bullet nav.
    if (!shift && !meta && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const head = state.selection.headId;
      clearSelection();
      state.focusId = head;
      state.caretOffset = null;
      rerender();
      // fall through to normal cursor movement below
    } else {
      // Any other unhandled keystroke just clears selection.
      clearSelection();
      rerender();
      return;
    }
  }

  if (!id || !textEl) return;

  // Zoom in: Cmd+PageDown ; Zoom out: Cmd+PageUp
  if (meta && e.key === 'PageDown') { e.preventDefault(); zoomTo(id); return; }
  if (meta && e.key === 'PageUp') { e.preventDefault(); zoomOut(); return; }

  // Recursive collapse/expand: Cmd+Shift+.
  if (meta && shift && (e.key === '.' || e.key === '>' || e.code === 'Period')) {
    e.preventDefault();
    handleToggleCollapseRecursive(id);
    return;
  }

  // Copy current bullet + subtree as markdown: Cmd+Shift+C
  // (Only when no text selection — otherwise let the browser copy the selected text.)
  if (meta && shift && (e.key === 'c' || e.key === 'C')) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      e.preventDefault();
      copySubtreeMarkdown(id);
      return;
    }
  }

  // Cut current bullet + subtree: Cmd+X (only when no text selection within the bullet).
  if (meta && !shift && (e.key === 'x' || e.key === 'X')) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      e.preventDefault();
      copySubtreeMarkdown(id).then(() => handleDeleteBullet(id));
      return;
    }
  }

  // Delete current bullet (and subtree): Cmd+Shift+Backspace
  if (meta && shift && e.key === 'Backspace') {
    e.preventDefault();
    handleDeleteBullet(id);
    return;
  }

  // Toggle complete: Cmd+Enter
  if (meta && e.key === 'Enter') {
    e.preventDefault();
    handleToggleComplete(id);
    return;
  }

  // Toggle collapse: Cmd+.
  if (meta && !shift && e.key === '.') {
    e.preventDefault();
    handleToggleCollapse(id);
    return;
  }

  // Move bullet up/down: Cmd+ArrowUp/Down
  if (meta && e.key === 'ArrowUp') {
    e.preventDefault();
    captureCaret();
    handleMoveUp(id);
    return;
  }
  if (meta && e.key === 'ArrowDown') {
    e.preventDefault();
    captureCaret();
    handleMoveDown(id);
    return;
  }

  // Start multi-selection with Shift+ArrowUp/Down (no existing selection here).
  if (shift && !meta && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const zoom = getById(state.doc.root, state.zoomId) ?? state.doc.root;
    const target = e.key === 'ArrowUp' ? prevVisible(zoom, id) : nextVisible(zoom, id);
    if (!target) { e.preventDefault(); return; }
    e.preventDefault();
    captureCaret();
    (document.activeElement as HTMLElement | null)?.blur();
    window.getSelection()?.removeAllRanges();
    setSelection(id, target.id);
    rerender();
    return;
  }

  // Cursor up/down between bullets
  if (!meta && e.key === 'ArrowUp') {
    // Only if caret is at top-most line (simple heuristic: single line bullet)
    e.preventDefault();
    moveCursor(-1);
    return;
  }
  if (!meta && e.key === 'ArrowDown') {
    e.preventDefault();
    moveCursor(1);
    return;
  }

  // Tab / Shift+Tab → indent / outdent
  if (e.key === 'Tab') {
    e.preventDefault();
    captureCaret();
    if (shift) handleOutdent(id);
    else handleIndent(id);
    return;
  }

  // Enter
  if (e.key === 'Enter' && !shift && !meta) {
    e.preventDefault();
    handleEnter(id, textEl);
    return;
  }

  // Backspace merge at start
  if (e.key === 'Backspace') {
    if (handleBackspaceMerge(id, textEl)) {
      e.preventDefault();
      return;
    }
  }
}, true);

// Track caret on selection changes so undo restores it
document.addEventListener('selectionchange', () => {
  captureCaret();
});

// boot
loadFromDisk();
