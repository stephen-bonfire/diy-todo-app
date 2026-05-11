// Markdown <-> outline node tree.

import { Node, newNode } from './outline';

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

/** Serialize a node and its subtree to markdown. The given node is rendered at depth 0. */
export function serializeMarkdown(node: Node): string {
  const out: string[] = [];
  const walk = (n: Node, depth: number) => {
    const indent = '  '.repeat(depth);
    const mark = n.completed ? '- [x] ' : '- ';
    out.push(`${indent}${mark}${n.text}`);
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(node, 0);
  return out.join('\n');
}
