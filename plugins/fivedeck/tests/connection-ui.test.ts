import assert from "node:assert/strict";
import { test } from "node:test";
import { DevConClient, type ConnectionStatus } from "../src/core/devcon.ts";
import { handleConnectionRequest } from "../src/core/connection-ui.ts";

test("inspector reads do not connect and old bridge or arbitrary requests do nothing", async () => {
  const client = new DevConClient({ instance: () => "primary", connect: () => { throw new Error("must not connect"); } });
  let probes = 0; client.test = async () => { probes++; };
  const replies: ConnectionStatus[] = [];
  const reply = async (status: ConnectionStatus) => { replies.push(status); };
  await handleConnectionRequest({ event: "connection-status" }, client, reply);
  for (const event of ["bridge-install", "run", "quit", "CMND"]) await handleConnectionRequest({ event }, client, reply);
  assert.equal(probes, 0); assert.equal(replies.length, 1); client.dispose();
});

test("an immediate test on an unsaved client selection cannot probe the previous client", async () => {
  const client = new DevConClient({ instance: () => "primary" });
  let probes = 0; client.test = async () => { probes++; };
  const replies: ConnectionStatus[] = [];
  await handleConnectionRequest({ event: "connection-test", clientInstance: "secondary" }, client, async status => { replies.push(status); });
  assert.equal(probes, 0); assert.equal(replies[0].clientInstance, "secondary");
  assert.match(replies[0].message, /Saving client selection/);
  await handleConnectionRequest({ event: "connection-test", clientInstance: "primary" }, client, async () => undefined);
  assert.equal(probes, 1);
  await handleConnectionRequest({ event: "connection-test" }, client, async () => undefined);
  assert.equal(probes, 1); client.dispose();
});
