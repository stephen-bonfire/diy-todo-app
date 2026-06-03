#!/usr/bin/env node
/**
 * Build the macOS app icon (.icns) + tray icons from assets/icon.svg.
 *
 * Steps:
 *   1. Render SVG → PNG @ 1024 via @resvg/resvg-js
 *   2. Use macOS `sips` to generate all .iconset sizes
 *   3. Use macOS `iconutil` to convert .iconset → .icns
 *   4. Also emit smaller PNGs for the Tray (menu bar) icon
 *
 * Run: node scripts/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.resolve(__dirname, '..');
const SVG_PATH = path.join(ROOT, 'assets', 'icon.svg');
const BUILD_DIR = path.join(ROOT, 'build');
const ICONSET_DIR = path.join(BUILD_DIR, 'icon.iconset');

function sh(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function renderSvgToPng(svgPath, outPath, width) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
  const png = resvg.render().asPng();
  fs.writeFileSync(outPath, png);
}

function main() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
  fs.mkdirSync(ICONSET_DIR, { recursive: true });

  // Render the base 1024 PNG; this becomes the source for everything else.
  const masterPng = path.join(BUILD_DIR, 'icon-1024.png');
  renderSvgToPng(SVG_PATH, masterPng, 1024);

  // macOS .iconset requires these specific sizes & names.
  const sizes = [
    { name: 'icon_16x16.png',       size: 16 },
    { name: 'icon_16x16@2x.png',    size: 32 },
    { name: 'icon_32x32.png',       size: 32 },
    { name: 'icon_32x32@2x.png',    size: 64 },
    { name: 'icon_128x128.png',     size: 128 },
    { name: 'icon_128x128@2x.png',  size: 256 },
    { name: 'icon_256x256.png',     size: 256 },
    { name: 'icon_256x256@2x.png',  size: 512 },
    { name: 'icon_512x512.png',     size: 512 },
    { name: 'icon_512x512@2x.png',  size: 1024 },
  ];

  for (const { name, size } of sizes) {
    const out = path.join(ICONSET_DIR, name);
    sh(`sips -z ${size} ${size} ${JSON.stringify(masterPng)} --out ${JSON.stringify(out)} > /dev/null`);
  }

  // Build .icns
  const icnsPath = path.join(BUILD_DIR, 'icon.icns');
  sh(`iconutil -c icns ${JSON.stringify(ICONSET_DIR)} -o ${JSON.stringify(icnsPath)}`);

  // Tray icons (small, for the menu bar). Bundled into the renderer-accessible build dir.
  renderSvgToPng(SVG_PATH, path.join(BUILD_DIR, 'tray.png'), 32);
  renderSvgToPng(SVG_PATH, path.join(BUILD_DIR, 'tray@2x.png'), 64);

  console.log('Icons built:');
  console.log('  ', icnsPath);
  console.log('  ', path.join(BUILD_DIR, 'tray.png'));
  console.log('  ', path.join(BUILD_DIR, 'tray@2x.png'));
}

main();
