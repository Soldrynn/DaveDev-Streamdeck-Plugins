import assert from "node:assert/strict";
import test from "node:test";
import { readReleaseMetadata, validateReleaseTag } from "../validate-release-tag.mjs";

const metadata = () => ({
  manifest: { Version: "1.1.0.2" },
  packageJson: { version: "1.1.0" },
  packageLock: { version: "1.1.0", packages: { "": { version: "1.1.0" } } },
  project: "<Version>1.1.0.2</Version>",
  program: 'Write(new { version = "1.1.0.2" });'
});

test("accepts a matching Clef release tag", () => {
  assert.deepEqual(validateReleaseTag("clef-v1.1.0.2", metadata()), { plugin: "clef", version: "1.1.0.2" });
});

for (const tag of ["v1.1.0.2", "fivedeck-v1.1.0.2", "clef-v1.1.0", "clef-v1.1.0.2-rc1", "../clef-v1.1.0.2", "clef-v01.1.0.2", "clef-v1.1.0.65535", "clef-v1.1.0.2\nextra", "clef-v1.1.0.2\n", "clef-v1.1.0.2.*", "clef-v1.1.0.(2|3)"]) {
  test(`rejects invalid release tag ${JSON.stringify(tag)}`, () => assert.throws(() => validateReleaseTag(tag, metadata())));
}

for (const field of ["manifest", "packageJson", "packageLock", "lockfileRoot", "project", "program"]) {
  test(`rejects inconsistent ${field} version`, () => {
    const value = metadata();
    if (field === "manifest") value.manifest.Version = "1.1.0.1";
    if (field === "packageJson") value.packageJson.version = "1.0.0";
    if (field === "packageLock") value.packageLock.version = "1.0.0";
    if (field === "lockfileRoot") value.packageLock.packages[""].version = "1.0.0";
    if (field === "project") value.project = "<Version>1.1.0.1</Version>";
    if (field === "program") value.program = 'version = "1.1.0.1"';
    assert.throws(() => validateReleaseTag("clef-v1.1.0.2", value));
  });
}

test("current source metadata agrees with its prospective release tag", async () => {
  const current = await readReleaseMetadata();
  validateReleaseTag(`clef-v${current.manifest.Version}`, current);
});

for (const field of ["project", "program"]) {
  test(`requires exact literal version separators in ${field}`, () => {
    const value = metadata();
    value[field] = value[field].replaceAll("1.1.0.2", "1x1x0x2");
    assert.throws(() => validateReleaseTag("clef-v1.1.0.2", value));
  });
  test(`rejects multiple version declarations in ${field}`, () => {
    const value = metadata();
    value[field] += "\n" + value[field].replaceAll("1.1.0.2", "1.1.0.1");
    assert.throws(() => validateReleaseTag("clef-v1.1.0.2", value));
  });
}
