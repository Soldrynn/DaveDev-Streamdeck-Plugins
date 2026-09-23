import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { test } from "node:test";
import { cleanConsoleOutput, decodeRconPacket, encodeRconPacket, RconError, sendRcon, validateRconPassword } from "../src/core/rcon.ts";

const header = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const reply = (text: string) => Buffer.concat([header, Buffer.from(`print ${text}`)]);

async function fakeServer(handler: (command: string, send: (text: string) => void) => void) {
  const server = createSocket("udp4");
  server.on("message", (packet, remote) => {
    const body = packet.subarray(4).toString();
    handler(body, text => server.send(reply(text), remote.port, remote.address));
  });
  server.bind(0, "127.0.0.1");
  await once(server, "listening");
  return { port: server.address().port, close: () => server.close() };
}

test("packet encoding and decoding", () => {
  assert.deepEqual(encodeRconPacket("pw", "status"), Buffer.concat([header, Buffer.from("rcon pw status")]));
  assert.equal(decodeRconPacket(reply("hello\n")), "hello\n");
  assert.equal(decodeRconPacket(Buffer.from("print nope")), undefined);
  assert.equal(decodeRconPacket(Buffer.concat([header, Buffer.from("challenge 1")])), undefined);
  assert.equal(cleanConsoleOutput("\u001b[97m^2Started\u001b[0m resource\r"), "Started resource");
});

test("password validation", () => {
  assert.match(validateRconPassword("") ?? "", /Set an RCON password/);
  assert.match(validateRconPassword("has space") ?? "", /spaces/);
  assert.equal(validateRconPassword("S3cure-Pass"), undefined);
});

test("collects multi-packet replies", async () => {
  const server = await fakeServer((command, send) => {
    assert.equal(command, "rcon letmein ensure mymap");
    send("Stopping resource mymap\n");
    setTimeout(() => send("Started resource mymap\n"), 20);
  });
  try {
    const output = await sendRcon({ host: "127.0.0.1", port: server.port, password: "letmein", command: "ensure mymap", settleMs: 80 });
    assert.equal(output, "Stopping resource mymap\nStarted resource mymap");
  } finally {
    server.close();
  }
});

test("reports a rejected password", async () => {
  const server = await fakeServer((_command, send) => send("Invalid password.\n"));
  try {
    await assert.rejects(sendRcon({ host: "127.0.0.1", port: server.port, password: "wrong", command: "status" }),
      (error: unknown) => error instanceof RconError && error.code === "password");
  } finally {
    server.close();
  }
});

test("times out when nothing answers", async () => {
  const server = await fakeServer(() => undefined);
  try {
    await assert.rejects(sendRcon({ host: "127.0.0.1", port: server.port, password: "pw", command: "status", timeoutMs: 150 }),
      (error: unknown) => error instanceof RconError && error.code === "timeout");
  } finally {
    server.close();
  }
});
