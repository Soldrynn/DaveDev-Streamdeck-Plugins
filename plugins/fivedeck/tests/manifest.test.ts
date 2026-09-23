import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { UUID } from "../src/actions/common.ts";

const manifest = JSON.parse(readFileSync(new URL("../com.davedev.fivedeck.sdPlugin/manifest.json", import.meta.url), "utf8"));

test("every registered action is in the manifest and vice versa", () => {
  const declared = manifest.Actions.map((action: { UUID: string }) => action.UUID).sort();
  assert.deepEqual(declared, Object.values(UUID).sort());
});

test("toggle-style actions own their states", () => {
  const byId = new Map(manifest.Actions.map((action: any) => [action.UUID, action]));
  for (const id of [UUID.command, UUID.launch]) {
    const action: any = byId.get(id);
    assert.equal(action.States.length, 2, `${id} has two states`);
    assert.equal(action.DisableAutomaticStates, true, `${id} manages its own state`);
  }
  assert.deepEqual((byId.get(UUID.dial) as any).Controllers, ["Encoder"]);
});
