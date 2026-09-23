import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { FxServerInstance, FxServerManager, launchArguments, launchEnvironment, normalizeProfile, splitArguments, validateConfig, type FxServerConfig, type FxServerDependencies } from "../src/core/fxserver.ts";

const config: FxServerConfig = {
  executable: "C:\\FXServer\\server\\FXServer.exe",
  dataDirectory: "C:\\FXServer\\server-data",
  configFile: "server.cfg",
  extraArgs: "+set onesync on +set sv_hostname \"My Dev Server\"",
  consoleMode: "hidden",
  gamePort: 30120,
  txAdminPort: 40120,
  autoRestart: false
};

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  written = "";
  constructor() {
    super();
    this.stdin.on("data", chunk => { this.written += String(chunk); });
  }
}

function harness(probeResult = true) {
  const children: FakeChild[] = [];
  const spawned: { command: string; args: string[]; options: any }[] = [];
  const killed: number[] = [];
  const deps: FxServerDependencies = {
    spawn: (command, args, options) => {
      spawned.push({ command, args, options });
      const child = new FakeChild();
      children.push(child);
      return child as any;
    },
    probe: async () => probeResult,
    exists: () => true,
    killTree: pid => { killed.push(pid); },
    now: () => 1_000
  };
  return { deps, children, spawned, killed };
}

test("argument splitting honours quotes and never needs a shell", () => {
  assert.deepEqual(splitArguments("+set a 1  +set sv_hostname \"My Server\" \"\""), ["+set", "a", "1", "+set", "sv_hostname", "My Server", ""]);
  assert.deepEqual(splitArguments(""), []);
});

test("launch arguments for server.cfg and txAdmin modes", () => {
  assert.deepEqual(launchArguments(config), ["+exec", "server.cfg", "+set", "onesync", "on", "+set", "sv_hostname", "My Dev Server"]);
  assert.deepEqual(launchArguments({ ...config, configFile: "", extraArgs: "" }), []);
  assert.equal(launchEnvironment({ ...config, configFile: "", txAdminPort: 40125 }, {}).TXHOST_TXA_PORT, "40125");
  assert.equal(launchEnvironment({ ...config, configFile: "" }, {}).TXHOST_TXA_PORT, undefined);
  assert.equal(launchEnvironment(config, {}).TXHOST_TXA_PORT, undefined);
});

test("config validation", () => {
  assert.match(validateConfig({ ...config, executable: "" }, () => true) ?? "", /Choose FXServer.exe/);
  assert.match(validateConfig({ ...config, executable: "C:\\evil\\cmd.exe" }, () => true) ?? "", /must be FXServer.exe/);
  assert.match(validateConfig(config, path => !path.endsWith("server-data")) ?? "", /does not exist/);
  assert.equal(validateConfig(config, () => true), undefined);
});

test("hidden servers start, count script errors, accept commands, and quit gracefully", async () => {
  const { deps, children, spawned, killed } = harness();
  const server = new FxServerInstance(deps);
  assert.equal(server.start(config), undefined);
  assert.equal(server.status, "starting");
  assert.equal(spawned[0].options.shell, false);
  assert.equal(spawned[0].options.windowsHide, true);
  assert.equal(spawned[0].options.cwd, config.dataDirectory);

  const child = children[0];
  child.stdout.write("\u001b[31mSCRIPT ERROR: @myres/client.lua:12: attempt to index a nil value\u001b[0m\r\nStarted resource ");
  child.stdout.write("myres\n");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(server.scriptErrors, 1);
  assert.match(server.lastError, /attempt to index a nil value/);
  assert.deepEqual(server.lines.slice(-1), ["Started resource myres"]);

  const before = server.lineCount;
  assert.equal(server.send("ensure myres"), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(child.written, "ensure myres\n");
  assert.deepEqual(server.linesSince(before), ["> ensure myres"]);

  server.stop();
  assert.equal(server.status, "stopping");
  await new Promise(resolve => setImmediate(resolve));
  assert.match(child.written, /quit\n$/);
  child.emit("exit", 0);
  assert.equal(server.status, "stopped");
  assert.deepEqual(killed, []);
  server.dispose();
});

test("window-mode servers are killed because their console isn't ours", () => {
  const { deps, spawned, killed } = harness();
  const server = new FxServerInstance(deps);
  server.start({ ...config, consoleMode: "window" });
  assert.equal(spawned[0].options.detached, true);
  assert.equal(spawned[0].options.stdio, "ignore");
  assert.equal(server.send("status"), false);
  server.stop();
  assert.deepEqual(killed, [4242]);
  server.dispose();
});

test("unexpected exits are crashes, and txAdmin PINs are captured", async () => {
  const { deps, children } = harness();
  const server = new FxServerInstance(deps);
  server.start({ ...config, configFile: "" });
  children[0].stdout.write("[txAdmin] Use the PIN below to register: 4819\n");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(server.txAdminPin, "4819");
  children[0].emit("exit", 1);
  assert.equal(server.status, "crashed");
  assert.match(server.lastFailure, /code 1/);
  server.dispose();
});

test("the manager keys servers by normalised profile name", () => {
  const { deps } = harness();
  const manager = new FxServerManager(deps);
  assert.equal(manager.get("Local"), manager.get(" local "));
  assert.equal(manager.find("other"), undefined);
  assert.equal(normalizeProfile(""), "local");
  assert.equal(normalizeProfile(undefined), "local");
});
