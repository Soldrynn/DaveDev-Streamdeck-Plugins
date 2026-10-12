import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandAction, EmoteAction, GameKeyAction, ToggleAction, transportOf } from "../src/actions/game-actions.ts";
import { DialAction } from "../src/actions/dial.ts";
import { DevConError } from "../src/core/devcon.ts";
import { LaunchAction } from "../src/actions/server-actions.ts";
import { controller } from "./helpers/game-fixture.ts";

function fixture(settings: Record<string, unknown>) {
  const context = controller();
  let persisted: any = settings;
  const titles: unknown[] = [];
  const action: any = { id: Math.random().toString(), isKey: () => true,
    setTitle: async (title: unknown) => { titles.push(title); }, setState: async () => undefined,
    setSettings: async (next: unknown) => { persisted = next; }, setImage: async () => undefined,
    showAlert: async () => undefined, setFeedback: async () => undefined };
  const errors: string[] = [];
  const fd: any = { game: context.game, log: (m: string) => errors.push(m) };
  const event: any = { action, payload: { settings } };
  return { ...context, fd, event, action, errors, titles, persisted: () => persisted };
}

test("all legacy command transport selections migrate to direct", () => {
  for (const value of [undefined, "bridge", "console", "chat", "direct", "bogus"]) assert.equal(transportOf({ transport: value }), "direct");
});

test("rapid command toggle presses alternate in order", async () => {
  const f = fixture({ mode: "toggle", commands: "hud 1", commandsOff: "hud 0", transport: "console" });
  const action = new CommandAction(f.fd); action.onWillAppear(f.event);
  await Promise.all([action.onKeyDown(f.event), action.onKeyDown(f.event), action.onKeyDown(f.event)]);
  assert.deepEqual(f.connection.lines, [["hud 1"], ["hud 0"], ["hud 1"]]);
  assert.equal(f.persisted().on, true);
  assert.deepEqual(f.native.log, []);
  assert(f.titles.includes("SENT")); f.game.dispose();
});

test("rapid developer toggles alternate and failed sends do not advance state", async () => {
  const f = fixture({ tool: "fps" }); const action = new ToggleAction(f.fd); action.onWillAppear(f.event);
  await Promise.all([action.onKeyDown(f.event), action.onKeyDown(f.event)]);
  assert.deepEqual(f.connection.lines, [["cl_drawFPS 1"], ["cl_drawFPS 0"]]);
  f.connection.failure = new Error("offline"); await action.onKeyDown(f.event);
  assert.equal(f.persisted().on, false); assert.equal(f.errors.length, 1); f.game.dispose();
});

test("hold release uses original command after setting change and on disappearance", async () => {
  const f = fixture({ mode: "hold", commands: "/+radiotalk" }); const action = new CommandAction(f.fd); action.onWillAppear(f.event);
  await action.onKeyDown(f.event);
  action.onDidReceiveSettings({ ...f.event, payload: { settings: { mode: "press", commands: "+other" } } });
  await action.onWillDisappear(f.event);
  assert.deepEqual(f.connection.lines, [["+radiotalk"], ["-radiotalk"]]);
  await action.onKeyUp(f.event); assert.equal(f.connection.lines.length, 2); f.game.dispose();
});

test("hold release cannot reconnect into a changed client or game process", async () => {
  for (const change of ["client", "process"]) {
    const f = fixture({ mode: "hold", commands: "+radiotalk" }); const action = new CommandAction(f.fd); action.onWillAppear(f.event);
    await action.onKeyDown(f.event);
    if (change === "client") f.overrides.clientInstance = "secondary"; else f.native.pids = [88];
    await action.onKeyUp(f.event);
    assert.equal(f.connection.lines.length, 1); assert.match(f.errors[0], /session changed/); f.game.dispose();
  }
});

test("emotes and dials use direct command path, not typed input", async () => {
  const f = fixture({ emote: "dance", holdCancel: false, transport: "chat" }); const emote = new EmoteAction(f.fd); emote.onWillAppear(f.event);
  emote.onKeyDown(f.event); await new Promise(resolve => setImmediate(resolve));
  const dial = new DialAction(f.fd); const dialEvent: any = { ...f.event, action: { ...f.action, isKey: () => false }, payload: { settings: { items: "Wave = e wave", transport: "console" } } };
  dial.onWillAppear(dialEvent); await dial.onDialDown(dialEvent);
  assert.deepEqual(f.connection.lines, [["e dance"], ["e wave"]]); assert.deepEqual(f.native.log, []); f.game.dispose();
});

test("Game Key release uses original key after settings change", async () => {
  const f = fixture({ key: "F13", mode: "hold" }); const action = new GameKeyAction(f.fd); action.onWillAppear(f.event);
  await action.onKeyDown(f.event);
  action.onDidReceiveSettings({ ...f.event, payload: { settings: { key: "F14", mode: "hold" } } });
  await action.onWillDisappear(f.event);
  assert.deepEqual(f.native.log, ["+F13", "-F13"]); f.game.dispose();
});

test("two rapid hold cycles each get a release", async () => {
  const f = fixture({ mode: "hold", commands: "+radiotalk" }); const action = new CommandAction(f.fd); action.onWillAppear(f.event);
  await Promise.all([action.onKeyDown(f.event), action.onKeyUp(f.event), action.onKeyDown(f.event), action.onKeyUp(f.event)]);
  assert.deepEqual(f.connection.lines, [["+radiotalk"], ["-radiotalk"], ["+radiotalk"], ["-radiotalk"]]); f.game.dispose();
});

test("hold target cannot change during asynchronous process lookup", async () => {
  const f = fixture({ mode: "hold", commands: "+radiotalk" }); const action = new CommandAction(f.fd); action.onWillAppear(f.event);
  f.game.status = async () => { f.overrides.clientInstance = "secondary"; return { running: true, focused: true, pids: [77] }; };
  await action.onKeyDown(f.event);
  assert.deepEqual(f.connection.lines, []); assert.match(f.errors[0], /selection changed/); f.game.dispose();
});


test("uncertain hold failure clears bookkeeping on queued release and allows a new press", async () => {
  const f = fixture({ mode: "hold", commands: "+radiotalk" }); const action = new CommandAction(f.fd); action.onWillAppear(f.event);
  f.connection.gate = async () => { f.connection.reset(); throw new DevConError("Write outcome uncertain", true); };
  await Promise.all([action.onKeyDown(f.event), action.onKeyUp(f.event)]);
  f.connection.gate = undefined;
  await Promise.all([action.onKeyDown(f.event), action.onKeyUp(f.event)]);
  assert.deepEqual(f.connection.lines, [["+radiotalk"], ["+radiotalk"], ["-radiotalk"]]);
  assert(f.errors.some(e => e.includes("Release the control in-game"))); f.game.dispose();
});

test("emote tap and hold cannot switch targets mid-press", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const hold of [false, true]) {
    const f = fixture({ emote: "dance", holdCancel: true }); const action = new EmoteAction(f.fd); action.onWillAppear(f.event);
    action.onKeyDown(f.event); f.overrides.clientInstance = "secondary";
    if (hold) t.mock.timers.tick(600);
    action.onKeyUp(f.event); await Promise.resolve();
    assert.deepEqual(f.connection.lines, []); assert.equal(f.errors.length, 1);
    action.onWillDisappear(f.event); f.game.dispose();
  }
});

test("delayed quit cannot switch targets mid-hold", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({}); const action = new LaunchAction(f.fd);
  action.onKeyDown(f.event); f.overrides.clientInstance = "secondary";
  t.mock.timers.tick(900); await Promise.resolve();
  assert.deepEqual(f.connection.lines, []); assert.equal(f.errors.length, 1);
  action.onWillDisappear(f.event); f.game.dispose();
});
