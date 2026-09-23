import assert from "node:assert/strict";
import { test } from "node:test";
import { currentCommand, dialItems, dialState, rotate } from "../src/actions/dial.ts";
import { devTool, keyCaption, keyModifiers } from "../src/actions/game-actions.ts";
import { outputFailed, serverCommandCaption, serverCommands } from "../src/actions/server-command.ts";
import { joinView } from "../src/actions/server-actions.ts";
import { fxServerConfig } from "../src/actions/fxserver.ts";

test("server command presets", () => {
  assert.deepEqual(serverCommands({ preset: "ensure", resource: "my-res" }), ["ensure my-res"]);
  assert.deepEqual(serverCommands({ preset: "refresh-ensure", resource: "[core]" }), ["refresh", "ensure [core]"]);
  assert.deepEqual(serverCommands({ preset: "refresh" }), ["refresh"]);
  assert.deepEqual(serverCommands({ preset: "custom", custom: "/say hi\n\nstatus" }), ["say hi", "status"]);
  assert.equal(serverCommands({ preset: "ensure", resource: "bad name; quit" }), undefined, "resource names can't smuggle commands");
  assert.equal(serverCommands({ preset: "custom", custom: "" }), undefined);
  assert.equal(serverCommandCaption({ preset: "restart", resource: "hud" }), "hud");
  assert(outputFailed("^3Couldn't find resource nope.^7"));
  assert(!outputFailed("Started resource hud"));
});

test("FXServer key settings map to a launch config", () => {
  const cfg = fxServerConfig({ executable: "C:\\fx\\FXServer.exe", configPath: "D:\\data\\server.cfg", consoleMode: "window" }, "log.txt");
  assert.equal(cfg.dataDirectory, "D:\\data");
  assert.equal(cfg.configFile, "server.cfg");
  assert.equal(cfg.consoleMode, "window");
  const tx = fxServerConfig({ executable: "C:\\fx\\FXServer.exe", mode: "txadmin", consoleMode: "bogus" }, "log.txt");
  assert.equal(tx.dataDirectory, "C:\\fx");
  assert.equal(tx.configFile, "");
  assert.equal(tx.consoleMode, "hidden");
});

test("game key captions and modifiers", () => {
  assert.deepEqual(keyModifiers({ modifiers: ["shift", "ctrl", "shift", "meta"] }), ["shift", "ctrl"]);
  assert.equal(keyCaption({ key: "f13", modifiers: ["ctrl"] }), "CTRL+F13");
  assert.equal(keyCaption({}), "SET KEY");
});

test("dev tools and custom toggles", () => {
  assert.equal(devTool({ tool: "netgraph" }).on, "netgraph 1");
  assert.equal(devTool({}).label, "Resmon");
  assert.deepEqual(devTool({ tool: "custom", customLabel: "Hud", customOn: "hud on", customOff: "hud off" }), { label: "Hud", on: "hud on", off: "hud off" });
});

test("command dial lists and ranges", () => {
  assert.deepEqual(dialItems("Dance = e dance\ne wave\n// skip"), [{ label: "Dance", command: "e dance" }, { label: "e wave", command: "e wave" }]);
  const list = dialState({ items: "a\nb\nc", index: 2 });
  assert.equal(rotate(list, 1).index, 0, "wraps forward");
  assert.equal(rotate(list, -4).index, 1, "wraps backward");
  assert.equal(rotate({ ...list, wrap: false }, 5).index, 2, "clamps");
  assert.deepEqual(currentCommand(list), ["c"]);
  const range = dialState({ mode: "range", min: 1, max: 5, value: 5, template: "radio {value}" });
  assert.equal(rotate(range, 1).value, 1, "wraps to min");
  assert.equal(rotate({ ...range, value: 1 }, -1).value, 5, "wraps to max");
  assert.equal(rotate({ ...range, wrap: false }, 3).value, 5);
  assert.deepEqual(currentCommand({ ...range, value: 3 }), ["radio 3"]);
});

test("join key views", () => {
  assert.equal(joinView(undefined, undefined).value, "SETUP");
  const target = { kind: "join", code: "abc123" } as const;
  assert.equal(joinView(target, undefined).label, "checking");
  assert.equal(joinView(target, undefined).title, "ABC123");
  const online = joinView(target, { online: true, name: "Lab", players: 5, maxPlayers: 10, connect: "cfx.re/join/abc123", checkedAt: 0 });
  assert.equal(online.value, "5/10");
  assert.equal(online.meter, 0.5);
  assert.equal(joinView(target, { online: undefined, name: "", connect: "", checkedAt: 0 }).value, "JOIN");
  assert.equal(joinView(target, { online: false, name: "", connect: "", checkedAt: 0 }, "My RP").title, "My RP");
});
