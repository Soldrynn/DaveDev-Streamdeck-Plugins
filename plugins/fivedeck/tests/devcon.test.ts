import assert from "node:assert/strict";
import { once } from "node:events";
import { createConnection, createServer, type AddressInfo, type NetConnectOpts, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import {
  commandPacket, DevConClient, DevConError, DevConFrames, isCitizenInfo,
  MAX_COMMAND_BYTES, MAX_FRAME_BYTES, type ClientInstance, type ConnectionStatus,
} from "../src/core/devcon.ts";

// Independently construct the real Legacy wire layout, rather than using production
// encoders to build fixtures. Every network test binds only an ephemeral loopback port.
function frame(type: string, length: number): Buffer {
  const data = Buffer.alloc(length);
  data.write(type, 0, "ascii");
  data.writeUInt16BE(211, 4);
  data.writeUInt32BE(length, 6);
  return data;
}

function citizenInfo(commandLine = "FiveM.exe -fixture"): Buffer {
  const text = Buffer.from(commandLine + "\0", "utf8");
  const data = frame("AINF", 97 + text.length);
  data.writeUInt32LE(0x0eff8a1a, 12);
  data.writeUInt32LE(0x321f0c00, 20);
  data.write("CitizenFX", 24, "ascii");
  data.write("CitizenFX", 56, "ascii");
  data[88] = 0xff;
  data.writeUInt32BE(8, 89);
  data.writeUInt32BE(text.length, 93);
  text.copy(data, 97);
  return data;
}

function channelFrame(): Buffer {
  const data = frame("CHAN", 14);
  data.writeUInt32BE(0, 10); // CHAN has a ten-byte common header, not twelve.
  return data;
}

async function until(check: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 1500;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await delay(2);
  }
}

interface Peer {
  socket: Socket;
  probe?: Buffer;
  commands: Buffer[];
  commandBytes: Buffer;
  invalid?: string;
}

interface Fixture {
  peers: Peer[];
  requested: NetConnectOpts[];
  connect: (options: NetConnectOpts) => Socket;
}

async function consoleFixture(
  t: TestContext,
  onProbe: (peer: Peer, index: number) => void = peer => { peer.socket.write(citizenInfo()); },
  onCommand: (peer: Peer) => void = () => undefined,
  options: { allowHalfOpen?: boolean } = {},
): Promise<Fixture> {
  const peers: Peer[] = [];
  const requested: NetConnectOpts[] = [];
  const server = createServer(options, socket => {
    const peer: Peer = { socket, commands: [], commandBytes: Buffer.alloc(0) };
    const index = peers.push(peer) - 1;
    let input: Buffer = Buffer.alloc(0);
    socket.on("error", () => undefined); // A reset is an intentional fixture in several tests.
    socket.on("data", chunk => {
      const hadProbe = !!peer.probe;
      input = Buffer.concat([input, chunk]);
      if (!peer.probe) {
        if (input.length < 4) return;
        peer.probe = Buffer.from(input.subarray(0, 4));
        input = input.subarray(4);
        if (!peer.probe.equals(Buffer.from("PPCR"))) {
          peer.invalid = "The first bytes were not the PPCR identity probe.";
          socket.destroy();
          return;
        }
        onProbe(peer, index);
      }
      const commandChunk = hadProbe ? chunk : input;
      if (commandChunk.length) peer.commandBytes = Buffer.concat([peer.commandBytes, commandChunk]);
      while (input.length >= 10) {
        const length = input.readUInt32BE(6);
        if (length < 13 || length > MAX_FRAME_BYTES) {
          peer.invalid = "Invalid CMND frame length.";
          socket.destroy();
          return;
        }
        if (input.length < length) return;
        peer.commands.push(Buffer.from(input.subarray(0, length)));
        input = input.subarray(length);
        onCommand(peer);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  t.after(async () => {
    for (const peer of peers) peer.socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  return {
    peers, requested,
    connect(options) {
      requested.push(options);
      assert.deepEqual(options, {
        host: "127.0.0.1", port: "port" in options && options.port === 29300 ? 29300 : 29200, family: 4,
      });
      return createConnection({ host: "127.0.0.1", port, family: 4 });
    },
  };
}

function clientFor(t: TestContext, fixture: Fixture, options: {
  instance?: () => ClientInstance;
  timeoutMs?: number;
  queueMaxAgeMs?: number;
  connect?: (options: NetConnectOpts) => Socket;
} = {}): DevConClient {
  const client = new DevConClient({ instance: () => "primary", connect: fixture.connect, timeoutMs: 500, ...options });
  t.after(() => client.dispose());
  return client;
}

function noCommands(fixture: Fixture): void {
  assert.ok(fixture.peers.every(peer => peer.commands.length === 0 && peer.commandBytes.length === 0));
  assert.ok(fixture.peers.every(peer => !peer.invalid));
}

function rejectsDevCon(promise: Promise<unknown>, uncertain = false, message?: RegExp): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DevConError);
    assert.equal(error.uncertain, uncertain);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("CMND contains protocol 211, total byte length, reserved zero, newlines and exactly one terminating NUL", () => {
  const lines = Object.freeze(["cl_drawfps true", "say café 😀"]);
  const data = commandPacket(lines);
  const payload = Buffer.from("cl_drawfps true\nsay café 😀\n\0", "utf8");
  assert.equal(data.toString("ascii", 0, 4), "CMND");
  assert.equal(data.readUInt16BE(4), 211);
  assert.equal(data.readUInt32BE(6), payload.length + 12);
  assert.equal(data.readUInt16BE(10), 0);
  assert.deepEqual(data.subarray(12), payload);
  assert.equal(data.subarray(12).filter(byte => byte === 0).length, 1);
  assert.deepEqual(lines, ["cl_drawfps true", "say café 😀"]);
});

test("CMND rejects empty lines and all ASCII control characters before opening a socket", () => {
  for (const lines of [[], [""], ["   "], ["valid", "\t"]]) assert.throws(() => commandPacket(lines), DevConError);
  for (const code of [...Array.from({ length: 32 }, (_, i) => i), 127]) {
    assert.throws(() => commandPacket([`say a${String.fromCharCode(code)}b`]), /control characters/);
  }
  assert.equal(commandPacket(['say "hello; world"']).subarray(12).toString(), 'say "hello; world"\n\0');
});

test("CMND enforces the exact UTF-8 payload boundary including separators and trailing newline", () => {
  assert.equal(commandPacket(["x".repeat(MAX_COMMAND_BYTES - 1)]).length, MAX_COMMAND_BYTES + 13);
  assert.throws(() => commandPacket(["x".repeat(MAX_COMMAND_BYTES)]), /UTF-8 bytes/);
  assert.equal(commandPacket(["é".repeat(511) + "a"]).length, MAX_COMMAND_BYTES + 13);
  assert.throws(() => commandPacket(["é".repeat(511) + "ab"]), /UTF-8 bytes/);
  assert.equal(commandPacket(["😀".repeat(255) + "abc"]).length, MAX_COMMAND_BYTES + 13);
  assert.throws(() => commandPacket(["😀".repeat(256)]), /UTF-8 bytes/);
  assert.equal(commandPacket(["a".repeat(511), "b".repeat(511)]).length, MAX_COMMAND_BYTES + 13);
  assert.throws(() => commandPacket(["a".repeat(512), "b".repeat(511)]), /UTF-8 bytes/);
});

test("reply decoder accepts every two-part split and one-byte fragmentation of AINF", () => {
  const info = citizenInfo("FiveM.exe --name=é😀");
  for (let split = 0; split <= info.length; split++) {
    const decoder = new DevConFrames();
    assert.deepEqual([...decoder.push(info.subarray(0, split)), ...decoder.push(info.subarray(split))], [info]);
  }
  const decoder = new DevConFrames();
  const received = [...info].flatMap(byte => decoder.push(Buffer.from([byte])));
  assert.deepEqual(received, [info]);
});

test("reply decoder handles coalesced CHAN/CVAR/PRNT replies and retains a trailing partial frame", () => {
  const frames = [citizenInfo(), channelFrame(), frame("CVAR", 93), frame("PRNT", 41)];
  const decoder = new DevConFrames();
  const data = Buffer.concat(frames);
  assert.deepEqual(decoder.push(data.subarray(0, data.length - 1)), frames.slice(0, -1));
  assert.deepEqual(decoder.push(data.subarray(-1)), frames.slice(-1));
  assert.deepEqual(decoder.push(Buffer.alloc(0)), []);
});

test("reply decoder rejects unsupported protocol and invalid or oversized lengths before buffering bodies", () => {
  for (const length of [0, 9, MAX_FRAME_BYTES + 1, 0xffffffff]) {
    const header = frame("AINF", 10);
    header.writeUInt32BE(length, 6);
    assert.throws(() => new DevConFrames().push(header), /unsupported protocol/);
  }
  for (const protocol of [0, 210, 212, 0xffff]) {
    const header = frame("AINF", 10);
    header.writeUInt16BE(protocol, 4);
    assert.throws(() => new DevConFrames().push(header), /unsupported protocol/);
  }
  const largest = frame("TEST", MAX_FRAME_BYTES);
  assert.deepEqual(new DevConFrames().push(largest), [largest]);
});

test("reply decoder bounds the cumulative handshake even when individual frames are valid", () => {
  const decoder = new DevConFrames();
  const largest = frame("TEST", MAX_FRAME_BYTES);
  for (let i = 0; i < 16; i++) assert.equal(decoder.push(largest).length, 1);
  assert.throws(() => decoder.push(Buffer.from([0])), /too large/);
});

test("CitizenFX identity requires both names, a consistent command-line length, and a terminator", () => {
  assert.equal(isCitizenInfo(citizenInfo()), true);
  assert.equal(isCitizenInfo(citizenInfo("")), true);
  assert.equal(isCitizenInfo(citizenInfo("é😀")), true);
  assert.equal(isCitizenInfo(Buffer.alloc(97)), false);
  const changes = [
    (data: Buffer) => { data.write("NOPE", 0); },
    (data: Buffer) => { data[24] = 88; },
    (data: Buffer) => { data[56] = 88; },
    (data: Buffer) => { data.writeUInt32BE(0, 93); },
    (data: Buffer) => { data.writeUInt32BE(data.length, 93); },
    (data: Buffer) => { data[data.length - 1] = 1; },
  ];
  for (const change of changes) {
    const data = citizenInfo();
    change(data);
    assert.equal(isCitizenInfo(data), false);
  }
});

test("CitizenFX identity does not accept high-bit aliases of ASCII magic or names", () => {
  for (const offset of [0, 1, 2, 3, 24, 56]) {
    const data = citizenInfo();
    data[offset] |= 0x80;
    assert.equal(isCitizenInfo(data), false, `Non-ASCII byte at offset ${offset} must not match.`);
  }
});

test("test connection validates AINF but never transmits a command", async t => {
  const fixture = await consoleFixture(t);
  const client = clientFor(t, fixture);
  const phases: string[] = [];
  client.subscribe(status => phases.push(status.phase));
  await client.test();
  assert.equal(client.status.phase, "ready");
  assert.deepEqual(phases, ["connecting", "ready"]);
  assert.equal(fixture.peers.length, 1);
  assert.equal(fixture.peers[0].probe?.toString(), "PPCR");
  await until(() => fixture.peers[0].socket.destroyed, "The probe socket should close gracefully.");
  noCommands(fixture);
});

test("send uses one validated fresh connection and one complete multiline CMND without awaiting execution", async t => {
  const fixture = await consoleFixture(t);
  const client = clientFor(t, fixture);
  const phases: string[] = [];
  client.subscribe(status => phases.push(status.phase));
  const lines = ["say café 😀", "cl_drawfps true"];
  await client.send(lines);
  await until(() => fixture.peers[0]?.commands.length === 1, "The complete command frame should arrive.");
  assert.deepEqual(fixture.peers[0].commands[0], commandPacket(lines));
  assert.deepEqual(phases, ["connecting", "transmitted"]);
  assert.match(client.status.message, /not confirmed/);
  assert.equal(fixture.requested.length, 1);
  await until(() => fixture.peers[0].socket.destroyed, "The command socket should close gracefully.");
});

test("primary and secondary selection use only the expected IPv4 loopback ports", async t => {
  const fixture = await consoleFixture(t);
  let instance: ClientInstance = "primary";
  const client = clientFor(t, fixture, { instance: () => instance });
  await client.test();
  instance = "secondary";
  client.reset();
  await client.test();
  assert.deepEqual(fixture.requested, [
    { host: "127.0.0.1", port: 29200, family: 4 },
    { host: "127.0.0.1", port: 29300, family: 4 },
  ]);
  assert.equal(client.status.clientInstance, "secondary");
});

test("status copies, throwing listeners, and unsubscribe cannot disrupt the transport", async t => {
  const fixture = await consoleFixture(t);
  const client = clientFor(t, fixture);
  const initial = client.status;
  initial.message = "mutated";
  assert.notEqual(client.status.message, "mutated");
  client.subscribe(status => { status.message = "listener mutation"; throw new Error("UI failed"); });
  const seen: ConnectionStatus[] = [];
  const unsubscribe = client.subscribe(status => seen.push(status));
  await client.test();
  assert.deepEqual(seen.map(status => status.phase), ["connecting", "ready"]);
  assert.ok(seen.every(status => status.message !== "listener mutation" && status.at > 0));
  unsubscribe();
  await client.test();
  assert.equal(seen.length, 2);
});

test("invalid input rejects before any connection or state change", async t => {
  const fixture = await consoleFixture(t);
  const client = clientFor(t, fixture);
  await rejectsDevCon(client.send(["bad\0command"]), false, /control/);
  await rejectsDevCon(client.send(["x".repeat(MAX_COMMAND_BYTES)]), false, /UTF-8/);
  assert.equal(fixture.requested.length, 0);
  assert.equal(client.status.phase, "idle");
});

test("send waits for complete AINF and accepts coalesced ancillary frames", async t => {
  const info = citizenInfo();
  const fixture = await consoleFixture(t, peer => { peer.socket.write(info.subarray(0, 50)); });
  const client = clientFor(t, fixture);
  const sent = client.send(["cl_drawfps true"]);
  await until(() => !!fixture.peers[0]?.probe, "The probe should arrive.");
  await delay(15);
  noCommands(fixture);
  fixture.peers[0].socket.write(Buffer.concat([info.subarray(50), channelFrame(), frame("CVAR", 93)]));
  await sent;
  await until(() => fixture.peers[0].commands.length === 1, "A single command should follow identity validation.");
});

test("well-framed non-identity replies are skipped until AINF arrives", async t => {
  const fixture = await consoleFixture(t, peer => { peer.socket.write(Buffer.concat([channelFrame(), citizenInfo()])); });
  const client = clientFor(t, fixture);
  await client.send(["cl_drawfps true"]);
  await until(() => fixture.peers[0]?.commands.length === 1, "The command should follow the AINF frame.");
});

test("duplicate identity frames cannot cause duplicate command transmission", async t => {
  const fixture = await consoleFixture(t, peer => { peer.socket.write(Buffer.concat([citizenInfo(), citizenInfo()])); });
  const client = clientFor(t, fixture);
  await client.send(["say once"]);
  await until(() => fixture.peers[0]?.socket.destroyed, "The connection should close after one transmission.");
  assert.equal(fixture.peers[0].commands.length, 1);
  assert.equal(fixture.requested.length, 1);
});

test("malformed identity and protocol replies fail closed without command transmission", async t => {
  for (const corruption of ["name", "length", "terminator", "protocol", "frame-size"]) {
    await t.test(corruption, async t => {
      const fixture = await consoleFixture(t, peer => {
        const data = citizenInfo();
        if (corruption === "name") data[24] = 88;
        if (corruption === "length") data.writeUInt32BE(0, 93);
        if (corruption === "terminator") data[data.length - 1] = 1;
        if (corruption === "protocol") data.writeUInt16BE(212, 4);
        if (corruption === "frame-size") data.writeUInt32BE(MAX_FRAME_BYTES + 1, 6);
        peer.socket.write(data);
      });
      const client = clientFor(t, fixture);
      await rejectsDevCon(client.send(["cl_drawfps true"]));
      assert.equal(client.status.phase, "disconnected");
      assert.equal(fixture.requested.length, 1);
      noCommands(fixture);
    });
  }
});

test("silent or partial identity replies time out without retrying or sending commands", async t => {
  for (const partial of [false, true]) {
    await t.test(partial ? "partial frame" : "silence", async t => {
      const fixture = await consoleFixture(t, peer => { if (partial) peer.socket.write(citizenInfo().subarray(0, 9)); });
      const client = clientFor(t, fixture, { timeoutMs: 40 });
      await rejectsDevCon(client.send(["cl_drawfps true"]), false, /did not respond/);
      assert.equal(fixture.requested.length, 1);
      assert.equal(client.status.phase, "disconnected");
      noCommands(fixture);
    });
  }
});

test("early EOF and a TCP reset reject safely before transmission", async t => {
  for (const reset of [false, true]) {
    await t.test(reset ? "reset" : "EOF", async t => {
      const fixture = await consoleFixture(t, peer => {
        if (reset) peer.socket.resetAndDestroy();
        else peer.socket.end(citizenInfo().subarray(0, 50));
      });
      const client = clientFor(t, fixture);
      await rejectsDevCon(client.send(["cl_drawfps true"]));
      assert.equal(fixture.requested.length, 1);
      noCommands(fixture);
    });
  }
});

test("connection refusal and synchronous connector errors reject without retrying", async t => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  let attempts = 0;
  const refused = new DevConClient({ instance: () => "primary", timeoutMs: 300, connect: () => {
    attempts++;
    return createConnection({ host: "127.0.0.1", port });
  } });
  t.after(() => refused.dispose());
  await rejectsDevCon(refused.send(["cl_drawfps true"]), false, /Cannot connect/);
  assert.equal(attempts, 1);
  const thrown = new DevConClient({ instance: () => "primary", connect: () => {
    attempts++;
    throw new Error("cannot allocate socket");
  } });
  t.after(() => thrown.dispose());
  await rejectsDevCon(thrown.test(), false, /Could not open/);
  assert.equal(attempts, 2);
});

test("concurrent presses are serialized onto distinct connections with one CMND apiece", async t => {
  const fixture = await consoleFixture(t);
  const client = clientFor(t, fixture);
  const commands = ["say first", "say second", "say third"];
  await Promise.all(commands.map(command => client.send([command])));
  await until(() => fixture.peers.length === 3 && fixture.peers.every(peer => peer.commands.length === 1), "Each press should arrive once.");
  assert.deepEqual(fixture.peers.map(peer => peer.commands[0].subarray(12).toString()), commands.map(command => command + "\n\0"));
  assert.equal(fixture.requested.length, 3);
});

test("pending queue is bounded and reset cancels waiting presses without replay", async t => {
  const fixture = await consoleFixture(t, () => undefined);
  const client = clientFor(t, fixture);
  const pending = Array.from({ length: 8 }, (_, index) => client.send([`say ${index}`]));
  const settled = Promise.allSettled(pending);
  await rejectsDevCon(client.send(["say overflow"]), false, /Too many pending/);
  await until(() => !!fixture.peers[0]?.probe, "Only the active probe should arrive.");
  assert.equal(fixture.requested.length, 1);
  client.reset();
  assert.ok((await settled).every(result => result.status === "rejected"));
  assert.equal(fixture.requested.length, 1);
  assert.equal(client.status.phase, "idle");
  noCommands(fixture);
});

test("stale queued presses expire and a fresh press can still succeed", async t => {
  const fixture = await consoleFixture(t, (peer, index) => { if (index > 0) peer.socket.write(citizenInfo()); });
  const client = clientFor(t, fixture, { queueMaxAgeMs: 10 });
  const first = client.send(["say first"]);
  const second = rejectsDevCon(client.send(["say stale"]), false, /expired/);
  await until(() => !!fixture.peers[0]?.probe, "The first probe should arrive.");
  await delay(25);
  fixture.peers[0].socket.write(citizenInfo());
  await Promise.all([first, second]);
  assert.equal(fixture.requested.length, 1);
  await client.send(["say fresh"]);
  await until(() => fixture.peers[1]?.commands.length === 1, "A fresh press should recover the queue.");
  assert.equal(fixture.requested.length, 2);
});

test("a failed connection cancels already queued presses but does not poison a later explicit press", async t => {
  const fixture = await consoleFixture(t, (peer, index) => {
    if (index === 0) peer.socket.destroy();
    else peer.socket.write(citizenInfo());
  });
  const client = clientFor(t, fixture);
  const results = await Promise.allSettled([client.send(["say failed"]), client.send(["say cancelled"])]);
  assert.ok(results.every(result => result.status === "rejected"));
  assert.equal(fixture.requested.length, 1);
  assert.equal(client.generation, 1);
  noCommands(fixture);
  await client.send(["say fresh"]);
  await until(() => fixture.peers[1]?.commands.length === 1, "Only the new explicit press should be sent.");
  assert.equal(fixture.peers[1].commands[0].subarray(12).toString(), "say fresh\n\0");
});

test("reset cancels active and queued presses before switching client targets", async t => {
  const fixture = await consoleFixture(t, (peer, index) => { if (index > 0) peer.socket.write(citizenInfo()); });
  let instance: ClientInstance = "primary";
  const client = clientFor(t, fixture, { instance: () => instance });
  const settled = Promise.allSettled([client.send(["say old one"]), client.send(["say old two"])]);
  await until(() => !!fixture.peers[0]?.probe, "The original client should be probed.");
  instance = "secondary";
  client.reset();
  assert.ok((await settled).every(result => result.status === "rejected"));
  assert.equal(client.status.phase, "idle");
  noCommands(fixture);
  await client.send(["say new target"]);
  await until(() => fixture.peers[1]?.commands.length === 1, "A new press should use the new target.");
  assert.deepEqual(fixture.requested.map(options => "port" in options ? options.port : undefined), [29200, 29300]);
});

test("dispose cancels active and queued requests and rejects all future work", async t => {
  const fixture = await consoleFixture(t, () => undefined);
  const client = clientFor(t, fixture);
  const settled = Promise.allSettled([client.send(["say active"]), client.send(["say queued"])]);
  await until(() => !!fixture.peers[0]?.probe, "The active probe should arrive.");
  client.dispose();
  assert.ok((await settled).every(result => result.status === "rejected"));
  await rejectsDevCon(client.send(["say later"]), false, /closing/);
  await rejectsDevCon(client.test(), false, /closing/);
  assert.equal(fixture.requested.length, 1);
  noCommands(fixture);
});

test("client selection changes without reset still cannot retarget an already queued press", async t => {
  const fixture = await consoleFixture(t, () => undefined);
  let instance: ClientInstance = "primary";
  const client = clientFor(t, fixture, { instance: () => instance });
  const active = client.send(["say first"]);
  const queued = rejectsDevCon(client.send(["say stale target"]), false, /cancelled/);
  await until(() => !!fixture.peers[0]?.probe, "The active request should start first.");
  instance = "secondary";
  fixture.peers[0].socket.write(citizenInfo());
  await Promise.all([active, queued]);
  assert.equal(fixture.requested.length, 1);
  assert.deepEqual(fixture.requested[0], { host: "127.0.0.1", port: 29200, family: 4 });
});

test("synchronous connecting listeners can reset or dispose without allowing a command to escape cancellation", async t => {
  for (const cancel of ["reset", "dispose"] as const) {
    await t.test(cancel, async t => {
      const fixture = await consoleFixture(t);
      const client = clientFor(t, fixture);
      client.subscribe(status => { if (status.phase === "connecting") client[cancel](); });
      await rejectsDevCon(client.send(["say cancelled"]));
      assert.equal(fixture.requested.length, 0, "Cancellation during connecting must precede socket creation.");
      noCommands(fixture);
    });
  }
});

test("completion listeners cannot retroactively cancel a completed probe or transmission", async t => {
  for (const action of ["test", "send"] as const) {
    await t.test(action, async t => {
      const fixture = await consoleFixture(t);
      const client = clientFor(t, fixture);
      client.subscribe(status => {
        if (status.phase === "ready" || status.phase === "transmitted") client.reset();
      });
      await (action === "test" ? client.test() : client.send(["say completed"]));
      assert.equal(client.status.phase, "idle");
      assert.equal(client.generation, 1);
      if (action === "test") noCommands(fixture);
      else await until(() => fixture.peers[0]?.commands.length === 1, "The completed command should arrive exactly once.");
    });
  }
});

test("successful requests eventually destroy sockets whose peer leaves the connection half open", async t => {
  const fixture = await consoleFixture(t, undefined, undefined, { allowHalfOpen: true });
  let socket: Socket | undefined;
  const client = clientFor(t, fixture, { connect: options => {
    socket = fixture.connect(options);
    return socket;
  } });
  await client.test();
  assert.equal(client.status.phase, "ready");
  await until(() => !!socket?.destroyed, "A half-open peer must not leak the successful client socket.");
});

test("continued log traffic cannot keep a successfully completed half-open socket alive", async t => {
  const timers = new Set<ReturnType<typeof setInterval>>();
  t.after(() => { for (const timer of timers) clearInterval(timer); });
  const fixture = await consoleFixture(t, peer => {
    peer.socket.write(citizenInfo());
    const timer = setInterval(() => {
      if (!peer.socket.destroyed) peer.socket.write(frame("PRNT", 41));
    }, 15);
    timers.add(timer);
  }, undefined, { allowHalfOpen: true });
  let socket: Socket | undefined;
  const client = clientFor(t, fixture, { connect: options => {
    socket = fixture.connect(options);
    return socket;
  } });
  await client.test();
  await until(() => !!socket?.destroyed, "An absolute cleanup deadline must close a chatty half-open peer.");
  assert.equal(client.status.phase, "ready");
  noCommands(fixture);
});

test("post-write error, EOF, timeout and cancellation are uncertain and are never retried", async t => {
  for (const failure of ["write-error", "EOF", "timeout", "reset", "dispose"]) {
    await t.test(failure, async t => {
      const fixture = await consoleFixture(t, peer => { peer.socket.write(citizenInfo()); }, peer => {
        if (failure === "EOF") peer.socket.end();
      });
      const connect = (options: NetConnectOpts): Socket => {
        const socket = fixture.connect(options);
        const originalWrite = socket.write.bind(socket);
        // Real TCP still carries the frame. Withhold the completion notification so
        // each failure can be placed deterministically after transmission starts.
        Object.defineProperty(socket, "write", { configurable: true, writable: true, value: (chunk: Buffer, callback: (error?: Error | null) => void): boolean => {
          if (chunk.subarray(0, 4).equals(Buffer.from("CMND"))) {
            return originalWrite(chunk, () => {
              if (failure === "write-error") callback(new Error("simulated write failure"));
            });
          }
          return originalWrite(chunk, callback);
        } });
        return socket;
      };
      const client = clientFor(t, fixture, { connect, timeoutMs: 80 });
      const result = rejectsDevCon(client.send(["say once"]), true, /may have run/);
      if (failure === "reset" || failure === "dispose") {
        await until(() => fixture.peers[0]?.commands.length === 1, "Transmission should begin before cancellation.");
        client[failure]();
      }
      await result;
      await until(() => fixture.peers[0]?.commands.length === 1, "The initial write should reach the fixture exactly once.");
      assert.equal(fixture.requested.length, 1);
      assert.equal(fixture.peers[0].commands.length, 1);
    });
  }
});
