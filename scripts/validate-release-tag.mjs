import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function validateReleaseTag(tag, { manifest, packageJson, packageLock, project, program }) {
  // The explicit allowlist prevents arbitrary paths or new plugins entering the release job.
  const match = /^clef-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag);
  assert(match && match[0] === tag, "Tag must be clef-v<major.minor.patch.build> without leading zeroes.");
  const version = match[1];
  assert(version.split(".").every((part) => Number(part) <= 65534), "Version components must fit the helper assembly version.");
  assert.equal(manifest.Version, version, "Tag and manifest versions differ.");
  const npmVersion = version.split(".").slice(0, 3).join(".");
  assert.equal(packageJson.version, npmVersion, "Tag and npm package versions differ.");
  assert.equal(packageLock.version, npmVersion, "Tag and lockfile versions differ.");
  assert.equal(packageLock.packages?.[""]?.version, npmVersion, "Tag and lockfile root versions differ.");
  // Extract metadata with fixed patterns; never compile a pattern from a tag.
  const assemblyVersions = [...project.matchAll(/<Version>([^<]*)<\/Version>/g)];
  const protocolVersions = [...program.matchAll(/\bversion\s*=\s*"([^"\r\n]*)"/g)];
  assert.equal(assemblyVersions.length, 1, "Expected exactly one helper assembly version.");
  assert.equal(protocolVersions.length, 1, "Expected exactly one helper protocol version.");
  assert.equal(assemblyVersions[0][1], version, "Tag and helper assembly versions differ.");
  assert.equal(protocolVersions[0][1], version, "Tag and helper protocol versions differ.");
  return { plugin: "clef", version };
}

export async function readReleaseMetadata(root = repositoryRoot) {
  const pluginRoot = join(root, "plugins", "clef");
  const read = (path) => readFile(join(pluginRoot, path), "utf8");
  return {
    manifest: JSON.parse(await read("com.davedev.clef.sdPlugin/manifest.json")),
    packageJson: JSON.parse(await read("package.json")),
    packageLock: JSON.parse(await read("package-lock.json")),
    project: await read("helper/ClefBridge/ClefBridge.csproj"),
    program: await read("helper/ClefBridge/Program.cs")
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateReleaseTag(process.argv[2] ?? "", await readReleaseMetadata());
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `plugin=${result.plugin}\nversion=${result.version}\n`);
  }
  console.log(`Validated ${result.plugin} release ${result.version}.`);
}
