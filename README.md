# Todo List

A minimalist outliner for macOS. Keyboard-first, drag-to-reorder, auto-save.

## Features

- Hierarchical bullets; nest as deep as you want.
- Drag bullets to reorder; subtree moves with it.
- Shift+click to multi-select; cut, copy, delete as a block.
- Arrow keys to navigate. Cmd+X/C/V to cut/copy/paste.
- Cmd+Page Down to zoom into a bullet. Cmd+. to collapse.
- Checkboxes with Cmd+Enter. State survives copy-paste.
- Dark mode support. Auto-save to `~/Library/Application Support/Todo List/outline.json`.

## Getting Started

```bash
npm install
npm run dev
```

In another terminal:

```bash
npm run electron:dev
```

Or build and run locally:

```bash
npm start
```

## Build for macOS

```bash
npm run dist
```

Creates a DMG in `release/`. After merging to main, rebuild and reinstall the `/Applications` bundle or the Dock icon keeps launching the old build—see `memory/reinstall-app-after-merge.md` for the full sequence.

## Stack

Vite, React, TypeScript, Electron, electron-builder.
