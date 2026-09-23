// Generates every static FiveDeck image from src/core/brand.ts: the app icon source, the category
// icon, action-list icons (monochrome white, per Elgato guidelines), and key images at 1x and 2x.
// Run: npm run assets
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { halftoneSvg, keySvg, markSvg, PALETTE } from "../src/core/brand.ts";
import { GLYPHS, LIST_GLYPHS } from "../src/core/glyphs.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = join(root, "com.davedev.fivedeck.sdPlugin", "assets");
const actions = join(assets, "actions");
await mkdir(actions, { recursive: true });

const written = [];
async function write(path, content) {
  await writeFile(path, content);
  written.push(path);
}

// App icon source (rendered to PNG by the build). 512-unit canvas.
const pitch = 84;
const key = 70;
const markWidth = pitch * 2 + key;
const markHeight = pitch * 4 + key;
await write(join(root, "branding", "fivedeck-app-icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop stop-color="#332D30"/>
      <stop offset="1" stop-color="${PALETTE.ink}"/>
    </linearGradient>
    <clipPath id="tile"><rect width="512" height="512" rx="112"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="512" height="512" fill="url(#bg)"/>
    ${halftoneSvg(512, 26, PALETTE.steel, 0.6)}
    <rect x="0" y="92" width="16" height="128" fill="${PALETTE.pink}"/>
  </g>
  ${markSvg({ x: (512 - markWidth) / 2, y: (512 - markHeight) / 2 - 4, pitch, key, radius: 16, lit: PALETTE.white, accent: PALETTE.pink, unlit: PALETTE.steelLight, unlitOpacity: 0.28, depth: 7 })}
</svg>
`);

// Category icon: the mark alone, monochrome white, 28 × 28 (and 56 × 56).
for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
  await write(join(assets, `category${suffix}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${28 * scale}" height="${28 * scale}" viewBox="0 0 28 28">
  ${markSvg({ x: 6.9, y: 1.5, pitch: 5.1, key: 4.4, radius: 1, lit: "#FFFFFF", accent: "#FFFFFF", unlit: "#FFFFFF", unlitOpacity: 0.16 })}
</svg>
`);
}

for (const [name, glyph] of Object.entries(GLYPHS)) {
  for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
    await write(join(actions, `${name}${suffix}.svg`), keySvg(glyph, 72 * scale));
  }
}

// "On" states: the same glyph over a pink wash with a lit bottom edge.
for (const name of ["command", "launch"]) {
  const lit = `<rect width="72" height="72" fill="${PALETTE.pink}" opacity=".2"/>${GLYPHS[name]}<rect x="0" y="68" width="72" height="4" fill="${PALETTE.pink}"/>`;
  for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
    await write(join(actions, `${name}-on${suffix}.svg`), keySvg(lit, 72 * scale, "on"));
  }
}

// Stream Deck + touch-strip background (200 × 100 per dial).
await mkdir(join(assets, "backgrounds"), { recursive: true });
for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
  await write(join(assets, "backgrounds", `strip${suffix}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${200 * scale}" height="${100 * scale}" viewBox="0 0 200 100">
  <defs>
    <linearGradient id="strip" x1="0" y1="0" x2="200" y2="100" gradientUnits="userSpaceOnUse">
      <stop stop-color="#2E292B"/>
      <stop offset="1" stop-color="${PALETTE.ink}"/>
    </linearGradient>
  </defs>
  <rect width="200" height="100" fill="url(#strip)"/>
  <g transform="translate(100 0)">${halftoneSvg(100, 6.5)}</g>
  <rect x="0" y="8" width="3" height="22" fill="${PALETTE.pink}"/>
</svg>
`);
}

for (const [name, glyph] of Object.entries(LIST_GLYPHS)) {
  for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
    await write(join(actions, `${name}-list${suffix}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${20 * scale}" height="${20 * scale}" viewBox="0 0 20 20">
  <g transform="translate(10 10) scale(0.36) translate(-36 -30)">${glyph}</g>
</svg>
`);
  }
}

console.log(`Wrote ${written.length} assets.`);
