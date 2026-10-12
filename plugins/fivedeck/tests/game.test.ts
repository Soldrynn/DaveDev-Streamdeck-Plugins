import assert from "node:assert/strict";
import { test } from "node:test";
import { controller, FakeNative, RecordingConnection } from "./helpers/game-fixture.ts";
import { DispatchError, fivemUri, GAME_PROCESS, GameController, releaseLines, typedText } from "../src/core/game.ts";
import { findKey } from "../src/core/keys.ts";
import { inputSettings } from "../src/core/settings.ts";


test("process names and command helpers", () => {
  for (const name of ["FiveM_GTAProcess.exe", "FiveM_b3258_GTAProcess.exe", "FiveM_cl2_b3095_GTAProcess.exe", "RedM_b1491_GTAProcess.exe"]) assert(GAME_PROCESS.test(name));
  assert(!GAME_PROCESS.test("FiveM.exe"));
  assert.deepEqual(releaseLines(["/+radiotalk", "+vc_ptt extra", "e wave"]), ["-radiotalk", "-vc_ptt"]);
  assert.equal(typedText("a\nb"), "a b");
  assert.equal(typedText("a".repeat(500)).length, 400);
  assert.equal(fivemUri({ kind: "join", code: "abc123" }), "fivem://connect/cfx.re/join/abc123");
});

test("direct commands require no native input, focus or bridge setup", async () => {
  const connection = new RecordingConnection({ instance: () => "primary" });
  const game = new GameController({ native: async () => { throw new Error("native must not be called"); },
    connection, settings: () => inputSettings({ autoBridge: true, bridgeKey: "F24" }), log: () => undefined });
  for (const legacy of [undefined, "bridge", "console", "chat"]) await game.run(["/e dance", "wait 100"], legacy as never);
  assert.deepEqual(connection.lines, Array.from({ length: 4 }, () => ["e dance", "wait 100"]));
  game.dispose();
});

test("connection failure never falls back to typing", async () => {
  const { game, native, connection } = controller();
  connection.failure = new Error("offline");
  await assert.rejects(game.run(["e dance"]), /offline/);
  assert.deepEqual(native.log, []);
  game.dispose();
});

test("explicit chat remains guarded and key down/up have hold time", async () => {
  const waits: number[] = [];
  const { game, native } = controller({ sleep: async ms => { waits.push(ms); } });
  await game.chat("hello", true);
  assert.deepEqual(native.log, ["+T", "-T", "type:hello", "+RETURN", "-RETURN"]);
  assert(waits.filter(ms => ms >= 50).length >= 3);
  native.log = [];
  native.foreground = "notepad.exe";
  await assert.rejects(game.chat("never", true), (e: unknown) => e instanceof DispatchError && e.reason === "not-focused");
  assert.deepEqual(native.log, []);
  game.dispose();
});

test("focus lost during chat delay prevents typed content and still releases key", async () => {
  const native = new FakeNative();
  const { game } = controller({ native, sleep: async () => { native.foreground = "notepad.exe"; } });
  await assert.rejects(game.chat("private text", true), /active window/);
  assert.deepEqual(native.log, ["+T", "-T"]);
  game.dispose();
});

test("held keys release across focus changes, failed down, and disposal", async () => {
  const { game, native } = controller();
  await game.key(findKey("F13")!, ["shift"], "down");
  native.foreground = "notepad.exe";
  await game.key(findKey("F13")!, ["shift"], "up");
  assert.deepEqual(native.log, ["+LSHIFT +F13", "-F13 -LSHIFT"]);
  native.foreground = "FiveM_GTAProcess.exe";
  native.accept = false;
  await assert.rejects(game.key(findKey("F14")!, [], "down"), /rejected/);
  assert.deepEqual(native.log.slice(-2), ["+F14", "-F14"]);
  native.accept = true;
  await game.key(findKey("F15")!, [], "down");
  game.dispose();
  assert.equal(native.log.at(-1), "-F15");
  await assert.rejects(game.key(findKey("F15")!, [], "down"), /closing/);
});

test("Join Server refuses secondary before launching and aborts changed target", async () => {
  const { game, overrides, connection } = controller({ overrides: { clientInstance: "secondary" } });
  let launched = 0;
  game.launch = async () => { launched++; return true; };
  await assert.rejects(game.join({ kind: "join", code: "abc123" }, true), /primary client only/);
  assert.equal(launched, 0);
  overrides.clientInstance = "primary";
  game.launch = async () => { launched++; connection.reset(); return true; };
  await assert.rejects(game.join({ kind: "join", code: "abc123" }, true), /selection changed/);
  assert.equal(connection.lines.length, 0);
  game.dispose();
});
