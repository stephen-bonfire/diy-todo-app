# Development

## Project Structure

- `src/` — React/TypeScript renderer
  - `main.ts` — app shell, keyboard handling, copy/paste, selection
  - `outline.ts` — data model and tree operations
  - `markdown.ts` — parse/serialize markdown-style bullets
  - `render.ts` — DOM rendering
  - `style.css` — styles (light/dark aware)
- `electron/` — Electron main process
  - `main.ts` — window and IPC setup
  - `preload.ts` — bridge between main and renderer
- `build/` — app icon (source SVG + built .icns, .png)
- `scripts/` — icon build script

## Dev Workflow

```bash
npm run dev                    # Start Vite dev server on :5173
npm run electron:dev          # Launch Electron against dev server (separate terminal)
npm run build                 # Build renderer and Electron
npm run build:icon            # Rebuild icon from SVG
```

## After Merging to Main

Always rebuild and reinstall the packaged app bundle to `/Applications`, or the Dock icon keeps launching the old build.

```bash
npm run build:icon
npm run build
npx electron-builder --mac dir --arm64
rm -rf /Applications/Todo\ List.app
cp -R release/mac-arm64/Todo\ List.app /Applications/Todo\ List.app
touch /Applications/Todo\ List.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Todo\ List.app
killall Dock
```

Verify the install:
```bash
npx asar list /Applications/Todo\ List.app/Contents/Resources/app.asar | grep "dist/assets"
```

Should list the exact `dist/assets/index-*.js` hash the build just emitted.

Why: `/Applications/Todo List.app` is a self-contained bundle holding its own compiled renderer. Merging to main or running `npm start` changes nothing about it. User data (outline.json) lives in `~/Library/Application Support/Todo List/`, not inside the bundle, so replacing it is safe.

## Full Distribution Build

```bash
npm run dist
```

Creates a universal macOS DMG (arm64 + x64) in `release/`. Requires Xcode Command Line Tools and a valid signing certificate. The dev build (`--mac dir`) is faster and sufficient for testing.

## Data Persistence

Outlines live as JSON in `~/Library/Application Support/Todo List/outline.json`. You can edit it directly, but the app will overwrite it on the next save. No cloud sync or collaboration.

## Stack

Vite, React, TypeScript, Electron, electron-builder.
