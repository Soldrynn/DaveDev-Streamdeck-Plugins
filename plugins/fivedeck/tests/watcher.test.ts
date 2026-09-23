import assert from "node:assert/strict";
import { test } from "node:test";
import { ServerWatcher } from "../src/core/watcher.ts";
import { inputSettings, serverSlot, num, oneOf } from "../src/core/settings.ts";

test("keys watching the same server share one poll and stop when unsubscribed", async () => {
  let calls = 0;
  const fetch = async (url: string) => {
    calls++;
    return new Response(JSON.stringify(url.endsWith("dynamic.json") ? { hostname: "x", clients: 1, sv_maxclients: "8" } : {}));
  };
  const watcher = new ServerWatcher(fetch);
  const target = { kind: "endpoint", host: "127.0.0.1", port: 30120 } as const;
  const seen: (number | undefined)[] = [];
  const stopA = watcher.watch(target, 5_000, snapshot => seen.push(snapshot?.players));
  const stopB = watcher.watch(target, 5_000, snapshot => seen.push(snapshot?.players));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 2, "one dynamic.json + one info.json request");
  assert.deepEqual(seen, [1, 1]);
  stopA();
  stopB();
  watcher.refresh(target);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 2, "no polling after the last key leaves");
  watcher.dispose();
});

test("settings readers clamp untrusted values", () => {
  assert.equal(num("9999", 90, 30, 600), 600);
  assert.equal(num("abc", 90, 30, 600), 90);
  assert.equal(num("", 90, 30, 600), 90);
  assert.equal(oneOf("chat", ["bridge", "console", "chat"] as const, "bridge"), "chat");
  assert.equal(oneOf("rm -rf", ["bridge", "console"] as const, "bridge"), "bridge");
  assert.deepEqual(inputSettings({}), { bridgeKey: "F24", consoleKey: "F8", chatKey: "T", inputDelayMs: 90, scanCodeOnly: false, focusGame: false, fivemPath: "", autoBridge: true });
  assert.deepEqual(serverSlot({ servers: { s2: { name: "Staging", host: "10.0.0.2", port: "30125", password: "pw" } } }, "s2"),
    { id: "s2", name: "Staging", host: "10.0.0.2", port: 30125, password: "pw" });
  assert.equal(serverSlot({}, "bogus").id, "s1");
  assert.equal(inputSettings({ bridgeKey: "f13" }).bridgeKey, "F13");
  assert.equal(inputSettings({ bridgeKey: "W" }).bridgeKey, "F24", "ordinary keys are refused as bridge keys");
});
