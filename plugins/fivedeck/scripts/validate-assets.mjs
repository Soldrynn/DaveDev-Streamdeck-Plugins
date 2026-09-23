// Checks every image the manifest and layouts reference: it exists, has the size Elgato expects,
// renders, and (for action-list and category icons) is monochrome white as the guidelines require.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginDirectory = join(root, "com.davedev.fivedeck.sdPlugin");
const manifest = JSON.parse(await readFile(join(pluginDirectory, "manifest.json"), "utf8"));

const expectations = new Map();
const expect = (base, width, height) => {
  expectations.set(`${base}.svg`, [width, height]);
  expectations.set(`${base}@2x.svg`, [width * 2, height * 2]);
};
expect(manifest.CategoryIcon, 28, 28);
for (const action of manifest.Actions) {
  expect(action.Icon, 20, 20);
  for (const state of action.States) expect(state.Image, 72, 72);
  if (action.Encoder) {
    expect(action.Encoder.Icon, 72, 72);
    if (action.Encoder.background) expect(action.Encoder.background, 200, 100);
    const layout = JSON.parse(await readFile(join(pluginDirectory, action.Encoder.layout), "utf8"));
    for (const item of layout.items.filter(item => item.type === "pixmap" && item.value)) {
      assert(existsSync(join(pluginDirectory, `${item.value}.svg`)), `${action.Encoder.layout} pixmap ${item.value}`);
    }
  }
}

for (const [relative, [width, height]] of expectations) {
  const path = join(pluginDirectory, relative);
  assert(existsSync(path), `${relative} exists`);
  const metadata = await sharp(path).metadata();
  assert.equal(metadata.width, width, `${relative} width`);
  assert.equal(metadata.height, height, `${relative} height`);
  await sharp(path).png().toBuffer();
}

const monochrome = [manifest.CategoryIcon, ...manifest.Actions.map(action => action.Icon)];
for (const base of monochrome) {
  for (const suffix of ["", "@2x"]) {
    const source = await readFile(join(pluginDirectory, `${base}${suffix}.svg`), "utf8");
    const colors = source.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    assert(colors.length > 0, `${base}${suffix} has a foreground`);
    assert(colors.every(color => /^#f{3}(?:f{3})?$/i.test(color)), `${base}${suffix} is monochrome white`);
  }
}

for (const [name, size] of [["plugin-icon.png", 256], ["plugin-icon@2x.png", 512]]) {
  const metadata = await sharp(join(pluginDirectory, "assets", name)).metadata();
  assert.equal(metadata.width, size, `${name} width`);
  assert.equal(metadata.height, size, `${name} height`);
}

// Every property inspector the manifest names must exist and load the shared scripts.
const inspectors = new Set(manifest.Actions.map(action => action.PropertyInspectorPath).filter(Boolean));
for (const path of inspectors) {
  const html = await readFile(join(pluginDirectory, path), "utf8");
  assert.match(html, /<script src="sdpi-components\.js"><\/script>/, `${path} loads sdpi-components`);
  assert.match(html, /<script src="fivedeck\.js"><\/script>/, `${path} loads fivedeck.js`);
}
const orphans = (await readdir(join(pluginDirectory, "ui"))).filter(file => file.endsWith(".html") && !inspectors.has(`ui/${file}`));
assert.deepEqual(orphans, [], "every inspector is referenced by the manifest");

console.log(`Validated ${expectations.size + 2} images and ${inspectors.size} property inspectors.`);
