// Bundles the plugin, copies licence files, renders the app icon, and stages the Windows build of
// the koffi FFI runtime next to the bundle. The native module is verified against the lockfile's
// integrity hash when it has to be fetched, so a cross-platform build cannot pick up a tampered binary.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginDirectory = join(root, "com.davedev.fivedeck.sdPlugin");
const binDirectory = join(pluginDirectory, "bin");
await rm(binDirectory, { recursive: true, force: true });
await mkdir(binDirectory, { recursive: true });

for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
  await copyFile(join(root, name), join(pluginDirectory, name));
}

const iconSource = join(root, "branding", "fivedeck-app-icon.svg");
const iconDirectory = join(pluginDirectory, "assets");
await sharp(iconSource, { density: 384 }).resize(256, 256).png().toFile(join(iconDirectory, "plugin-icon.png"));
await sharp(iconSource, { density: 384 }).resize(512, 512).png().toFile(join(iconDirectory, "plugin-icon@2x.png"));

await build({
  absWorkingDir: root,
  entryPoints: ["./src/plugin.ts"],
  outfile: "com.davedev.fivedeck.sdPlugin/bin/plugin.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["koffi"],
  banner: {
    js: "import { createRequire as __nodeCreateRequire } from 'node:module'; const require = __nodeCreateRequire(import.meta.url);"
  },
  sourcemap: true,
  minify: false,
  legalComments: "none",
  tsconfig: "tsconfig.json"
});

await stageKoffi();
console.log("Built com.davedev.fivedeck.sdPlugin/bin.");

async function stageKoffi() {
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  const modules = join(binDirectory, "node_modules");
  const koffiSource = join(root, "node_modules", "koffi");
  const koffiTarget = join(modules, "koffi");
  // Only the JavaScript loader is needed at runtime; the C++ sources, headers, and docs stay behind.
  for (const file of ["package.json", "index.js", "LICENSE.txt", "src/koffi/index.js", "src/koffi/src/static.js"]) {
    await mkdir(dirname(join(koffiTarget, file)), { recursive: true });
    await copyFile(join(koffiSource, file), join(koffiTarget, file));
  }

  const nativeName = "@koromix/koffi-win32-x64";
  const entry = lock.packages[`node_modules/${nativeName}`];
  if (!entry?.version || !entry.integrity || !entry.resolved) throw new Error(`${nativeName} is missing from package-lock.json.`);
  let nativeSource = join(root, "node_modules", nativeName);
  if (!existsSync(join(nativeSource, "win32_x64", "koffi.node"))) nativeSource = await fetchVerified(nativeName, entry);
  const nativeTarget = join(modules, nativeName);
  await mkdir(join(nativeTarget, "win32_x64"), { recursive: true });
  for (const file of ["package.json", "index.js", "win32_x64/koffi.node"]) {
    await copyFile(join(nativeSource, file), join(nativeTarget, file));
  }
}

async function fetchVerified(name, entry) {
  const cache = join(root, ".tools", `${name.replace("/", "+")}-${entry.version}`);
  if (existsSync(join(cache, "package", "win32_x64", "koffi.node"))) return join(cache, "package");
  const response = await fetch(entry.resolved);
  if (!response.ok) throw new Error(`Downloading ${name} failed with HTTP ${response.status}.`);
  const tarball = Buffer.from(await response.arrayBuffer());
  const [algorithm, expected] = entry.integrity.split("-", 2);
  const actual = createHash(algorithm).update(tarball).digest("base64");
  if (actual !== expected) throw new Error(`${name} integrity mismatch; refusing to package it.`);
  await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true });
  const archive = join(cache, "package.tgz");
  await writeFile(archive, tarball);
  execFileSync("tar", ["-xzf", "package.tgz"], { cwd: cache });
  await rm(archive);
  console.log(`Fetched and verified ${name}@${entry.version} for the Windows package.`);
  return join(cache, "package");
}

