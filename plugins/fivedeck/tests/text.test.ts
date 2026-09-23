import assert from "node:assert/strict";
import { test } from "node:test";
import { commandLines, consoleCommand, escapeXml, fillTemplate, formatUptimeCompact, stripCfxFormatting, truncateText } from "../src/core/text.ts";

test("strips Cfx and GTA formatting from server names", () => {
  assert.equal(stripCfxFormatting("^1Red^7 City ~r~RP~s~  |  Whitelisted"), "Red City RP | Whitelisted");
  assert.equal(stripCfxFormatting("\u0007Bell^9"), "Bell");
});

test("escapes XML and truncates by code point", () => {
  assert.equal(escapeXml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;");
  assert.equal(truncateText("Los Santos Roleplay", 10), "Los Santo…");
  assert.equal(truncateText("🚓🚓🚓", 3), "🚓🚓🚓");
  assert.equal(truncateText("🚓🚓🚓🚓", 3), "🚓🚓…");
});

test("splits commands and drops comments, blanks, and control characters", () => {
  assert.deepEqual(commandLines("e dance\r\n\n// note\n# note\n  /me waves \u0000\n\tt\u001b"), ["e dance", "/me waves", "t"]);
  assert.deepEqual(commandLines(undefined), []);
  assert.equal(consoleCommand("//e sit"), "e sit");
  assert.equal(consoleCommand("e sit"), "e sit");
});

test("formats uptime and fills templates", () => {
  assert.equal(formatUptimeCompact(12_400), "12s");
  assert.equal(formatUptimeCompact(2_530_000), "42m");
  assert.equal(formatUptimeCompact(11_220_000), "3h 07m");
  assert.equal(formatUptimeCompact(3 * 86_400_000 + 4 * 3_600_000), "3d 04h");
  assert.equal(fillTemplate("radio {value}", 3), "radio 3");
  assert.equal(fillTemplate("vol {V} {v}", "x"), "vol x x");
});
