// Release metadata must agree everywhere, licences must be present, and every bundled runtime
// dependency must appear in THIRD_PARTY_NOTICES.md at the version in the lockfile.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFile(join(root, ...parts), "utf8");
const packageJson = JSON.parse(await read("package.json"));
const lock = JSON.parse(await read("package-lock.json"));
const manifest = JSON.parse(await read("com.davedev.fivedeck.sdPlugin", "manifest.json"));
const notices = await read("THIRD_PARTY_NOTICES.md");
const pluginReadme = await read("com.davedev.fivedeck.sdPlugin", "README.txt");
const repositoryUrl = "https://github.com/Soldrynn/DaveDev-Streamdeck-Plugins";
const escape = value => value.replaceAll(".", "\\.");

assert.equal(packageJson.license, "Apache-2.0", "package licence");
assert.equal(packageJson.repository?.url, `git+${repositoryUrl}.git`, "repository URL");
assert.equal(packageJson.bugs?.url, `${repositoryUrl}/issues`, "issues URL");
assert.match(manifest.Version, new RegExp(`^${escape(packageJson.version)}\\.\\d+$`), "manifest version matches package.json");
assert.equal(lock.packages[""].version, packageJson.version, "lockfile version");
assert.equal(lock.packages[""].name, packageJson.name, "lockfile name");
assert.match(pluginReadme, new RegExp(`^FiveDeck v${escape(packageJson.version.split(".").slice(0, 2).join("."))}$`, "m"), "plugin README version");
assert.match(await read("LICENSE"), /^\s*Apache License\s*$/m, "Apache licence text");
assert.deepEqual(manifest.OS.map(os => os.Platform), ["windows"], "Windows-only manifest");

for (const name of ["@elgato/streamdeck", "@elgato/schemas", "@elgato/utils", "ws", "zod", "koffi", "@koromix/koffi-win32-x64"]) {
  const version = lock.packages[`node_modules/${name}`]?.version;
  assert(version, `${name} is in the lockfile`);
  assert(notices.includes(`\`${name}\` ${version}`), `${name} ${version} is listed in THIRD_PARTY_NOTICES.md`);
}
for (const range of Object.values(packageJson.dependencies ?? {})) assert.notEqual(range, "latest", "runtime dependencies are pinned");
for (const range of Object.values(packageJson.devDependencies ?? {})) assert.notEqual(range, "latest", "dev dependencies are pinned");

const bin = join(root, "com.davedev.fivedeck.sdPlugin", "bin");
if (existsSync(bin)) {
  for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
    assert.equal(await read("com.davedev.fivedeck.sdPlugin", name), await read(name), `${name} package copy`);
  }
  assert(existsSync(join(bin, "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node")), "Windows koffi runtime is packaged");
  assert(existsSync(join(bin, "node_modules", "koffi", "src", "koffi", "index.js")), "koffi loader is packaged");
}

console.log(`Validated release metadata and licences for FiveDeck ${manifest.Version}.`);
