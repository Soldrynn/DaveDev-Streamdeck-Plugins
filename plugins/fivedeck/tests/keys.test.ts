import assert from "node:assert/strict";
import { test } from "node:test";
import { allKeyNames, chordStrokes, findKey } from "../src/core/keys.ts";
import { layoutForTests } from "../src/core/win32.ts";

test("function keys F13-F24 carry the extended-range scan codes", () => {
  assert.deepEqual(findKey("F13"), { name: "F13", vk: 0x7c, scan: 0x64 });
  assert.deepEqual(findKey("f23"), { name: "F23", vk: 0x86, scan: 0x6e });
  assert.deepEqual(findKey("F24"), { name: "F24", vk: 0x87, scan: 0x76 });
  assert.deepEqual(findKey("F8"), { name: "F8", vk: 0x77, scan: 0x42 });
});

test("letters, digits, aliases, and extended keys", () => {
  assert.deepEqual(findKey("t"), { name: "T", vk: 0x54, scan: 0x14 });
  assert.deepEqual(findKey("0"), { name: "0", vk: 0x30, scan: 0x0b });
  assert.deepEqual(findKey("1"), { name: "1", vk: 0x31, scan: 0x02 });
  assert.equal(findKey("enter")?.name, "RETURN");
  assert.equal(findKey("`")?.name, "GRAVE");
  assert.equal(findKey("RCTRL")?.extended, true);
  assert.equal(findKey("nope"), undefined);
  assert.equal(new Set(allKeyNames()).size, allKeyNames().length, "key names are unique");
});

test("chords press modifiers first and release them last", () => {
  const f13 = findKey("F13")!;
  const names = chordStrokes(f13, ["ctrl", "shift"]).map(s => `${s.up ? "-" : "+"}${s.key.name}`);
  assert.deepEqual(names, ["+LCONTROL", "+LSHIFT", "+F13", "-F13", "-LSHIFT", "-LCONTROL"]);
  assert.deepEqual(chordStrokes(f13, [], "down").map(s => s.up), [false]);
  assert.deepEqual(chordStrokes(f13, ["alt"], "up").map(s => `${s.up ? "-" : "+"}${s.key.name}`), ["-F13", "-LMENU"]);
});

test("Win32 struct layouts match the x64 ABI", async () => {
  const layout = await layoutForTests();
  assert.equal(layout.input, 40, "sizeof(INPUT)");
  assert.equal(layout.entry, 568, "sizeof(PROCESSENTRY32W)");
});
