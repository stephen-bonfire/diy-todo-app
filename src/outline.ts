// Outline data model + pure tree operations.

export type Node = {
  id: string;
  text: string;
  collapsed: boolean;
  completed: boolean;
  children: Node[];
};

export type Doc = {
  root: Node; // hidden root; its children are top-level bullets
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newNode(text = ''): Node {
  return { id: uid(), text, collapsed: false, completed: false, children: [] };
}

export function newDoc(): Doc {
  const root = newNode('');
  root.id = 'root';
  root.children.push(newNode(''));
  return { root };
}

// --- lookup helpers ---

export type Path = number[]; // indexes from root down

export function findPath(root: Node, id: string, acc: Path = []): Path | null {
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    const p = [...acc, i];
    if (child.id === id) return p;
    const deeper = findPath(child, id, p);
    if (deeper) return deeper;
  }
  return null;
}

export function nodeAt(root: Node, path: Path): Node {
  let n = root;
  for (const i of path) n = n.children[i];
  return n;
}

export function parentOf(root: Node, path: Path): { parent: Node; index: number } | null {
  if (path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  return { parent: nodeAt(root, parentPath), index: path[path.length - 1] };
}

export function getById(root: Node, id: string): Node | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = getById(c, id);
    if (f) return f;
  }
  return null;
}

// Return previous visible node (within zoomRoot) for cursor up navigation.
export function prevVisible(zoomRoot: Node, id: string): Node | null {
  const flat = flattenVisible(zoomRoot);
  const idx = flat.findIndex((n) => n.id === id);
  if (idx <= 0) return null;
  return flat[idx - 1];
}

export function nextVisible(zoomRoot: Node, id: string): Node | null {
  const flat = flattenVisible(zoomRoot);
  const idx = flat.findIndex((n) => n.id === id);
  if (idx < 0 || idx >= flat.length - 1) return null;
  return flat[idx + 1];
}

export function flattenVisible(zoomRoot: Node): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    for (const c of n.children) {
      out.push(c);
      if (!c.collapsed) walk(c);
    }
  };
  walk(zoomRoot);
  return out;
}

// Return the contiguous visible range between two ids (inclusive), in document order.
export function rangeBetween(zoomRoot: Node, idA: string, idB: string): Node[] {
  const flat = flattenVisible(zoomRoot);
  const ia = flat.findIndex((n) => n.id === idA);
  const ib = flat.findIndex((n) => n.id === idB);
  if (ia < 0 || ib < 0) return [];
  const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
  return flat.slice(lo, hi + 1);
}

// --- snapshot for undo ---

export function clone(doc: Doc): Doc {
  return JSON.parse(JSON.stringify(doc));
}
