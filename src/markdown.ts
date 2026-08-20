// Markdown <-> outline node tree.

import { Node, newNode, findPath, nodeAt } from './outline';

const BULLET_RE = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/;
const CHECKBOX_RE = /^\[([ xX])\]\s+(.*)$/;

type Line = {
  indent: number;
  text: string;
  isBullet: boolean;
  completed: boolean;
};

function measureIndent(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 2;
    else break;
  }
  return n;
}

function parseLines(input: string): Line[] {
  const out: Line[] = [];
  for (const raw of input.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = raw.match(BULLET_RE);
    if (m) {
      const indent = measureIndent(m[1]);
      let text = m[2];
      let completed = false;
      const cb = text.match(CHECKBOX_RE);
      if (cb) {
        completed = cb[1].toLowerCase() === 'x';
        text = cb[2];
      }
      out.push({ indent, text, isBullet: true, completed });
    } else {
      out.push({ indent: measureIndent(raw), text: raw.trim(), isBullet: false, completed: false });
    }
  }
  return out;
}

// Build a forest from a flat indent-annotated list.
function buildTree(lines: Line[]): Node[] {
  const roots: Node[] = [];
  // stack of { indent, node }
  const stack: { indent: number; node: Node }[] = [];
  for (const ln of lines) {
    const node = newNode(ln.text);
    node.completed = ln.completed;
    // Pop until top has strictly smaller indent
    while (stack.length && stack[stack.length - 1].indent >= ln.indent) stack.pop();
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ indent: ln.indent, node });
  }
  return roots;
}

/**
 * Parse markdown-ish text into a list of root nodes.
 * Rule: if there are leading non-bullet lines (at indent 0) before any bullets,
 * fold them into a single header node that becomes the parent of the subsequent
 * indent-0 bullets — so a paste like:
 *
 *     My Section
 *     - one
 *     - two
 *
 * becomes a single root "My Section" with two children.
 */
export function parseMarkdown(input: string): Node[] {
  const lines = parseLines(input);
  if (lines.length === 0) return [];

  // Detect leading non-bullet lines at indent 0
  let headerEnd = 0;
  while (
    headerEnd < lines.length &&
    !lines[headerEnd].isBullet &&
    lines[headerEnd].indent === 0
  ) headerEnd++;

  if (headerEnd > 0 && headerEnd < lines.length) {
    const headerText = lines.slice(0, headerEnd).map((l) => l.text).join(' ');
    const rest = lines.slice(headerEnd);
    const restRoots = buildTree(rest);
    const header = newNode(headerText);
    header.children = restRoots;
    return [header];
  }

  return buildTree(lines);
}

// Indent written for each nesting level when serializing. Parsing stays width-agnostic —
// it compares indents rather than dividing by a fixed step — so older 2-space text still loads.
const INDENT = '    ';

/** Serialize a node and its subtree to markdown. The given node is rendered at depth 0. */
export function serializeMarkdown(node: Node): string {
  const out: string[] = [];
  const walk = (n: Node, depth: number) => {
    const indent = INDENT.repeat(depth);
    const mark = n.completed ? '- [x] ' : '- ';
    out.push(`${indent}${mark}${n.text}`);
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(node, 0);
  return out.join('\n');
}

function bulletLine(n: Node, depth: number): string {
  return `${INDENT.repeat(depth)}${n.completed ? '- [x] ' : '- '}${n.text}`;
}

// How many of a node's ancestors are themselves in `ids`.
function selectedAncestorCount(root: Node, n: Node, ids: Set<string>): number {
  const path = findPath(root, n.id);
  if (!path) return -1;
  let count = 0;
  for (let i = 1; i < path.length; i++) {
    if (ids.has(nodeAt(root, path.slice(0, i)).id)) count++;
  }
  return count;
}

/**
 * Serialize exactly the given nodes and nothing else. Descendants that were not
 * themselves selected are left out; nesting among the selected nodes is preserved.
 * Used for copying a multi-bullet selection, so the clipboard matches the highlight.
 */
export function serializeSelection(root: Node, nodes: Node[]): string {
  const ids = new Set(nodes.map((n) => n.id));
  const out: string[] = [];
  for (const n of nodes) {
    const depth = selectedAncestorCount(root, n, ids);
    if (depth < 0) continue;
    out.push(bulletLine(n, depth));
  }
  return out.join('\n');
}

/**
 * Serialize the given nodes as full subtrees, dropping any node already covered by a
 * selected ancestor so no bullet is emitted twice. Used for cut, where the clipboard
 * must hold everything the delete removes.
 */
export function serializeSubtrees(root: Node, nodes: Node[]): string {
  const ids = new Set(nodes.map((n) => n.id));
  return nodes
    .filter((n) => selectedAncestorCount(root, n, ids) === 0)
    .map((n) => serializeMarkdown(n))
    .join('\n');
}
