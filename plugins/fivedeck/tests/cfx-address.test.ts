import assert from "node:assert/strict";
import { test } from "node:test";
import { connectString, endpointBaseUrl, isLoopbackHost, parseServerTarget } from "../src/core/cfx-address.ts";

test("join codes in every shared form", () => {
  for (const input of [
    "3lamjz",
    " 3LAMJZ ",
    "cfx.re/join/3lamjz",
    "https://cfx.re/join/3lamjz",
    "http://cfx.re/join/3lamjz/",
    "https://cfx.re/join/3lamjz?utm=x",
    "fivem://connect/cfx.re/join/3lamjz",
    "connect cfx.re/join/3lamjz",
    "connect \"cfx.re/join/3lamjz\"",
    "https://servers.fivem.net/servers/detail/3lamjz",
    "servers.redm.net/servers/detail/3lamjz"
  ]) {
    assert.deepEqual(parseServerTarget(input), { kind: "join", code: "3lamjz" }, input);
  }
});

test("endpoints with and without ports", () => {
  assert.deepEqual(parseServerTarget("127.0.0.1"), { kind: "endpoint", host: "127.0.0.1", port: 30120 });
  assert.deepEqual(parseServerTarget("127.0.0.1:30121"), { kind: "endpoint", host: "127.0.0.1", port: 30121 });
  assert.deepEqual(parseServerTarget("localhost"), { kind: "endpoint", host: "localhost", port: 30120 });
  assert.deepEqual(parseServerTarget("fivem://connect/play.example.com:30150"), { kind: "endpoint", host: "play.example.com", port: 30150 });
  assert.deepEqual(parseServerTarget("connect 10.0.0.5:30120"), { kind: "endpoint", host: "10.0.0.5", port: 30120 });
  assert.deepEqual(parseServerTarget("[::1]:30120"), { kind: "endpoint", host: "::1", port: 30120 });
  assert.deepEqual(parseServerTarget("myserver:30120"), { kind: "endpoint", host: "myserver", port: 30120 });
});

test("rejects malformed input", () => {
  for (const input of ["", "   ", "abc", "1.2.3.4:0", "1.2.3.4:70000", "a:b:c", "bad host:30120", "https://cfx.re/join/", "999.1.1.1:30120", 42, undefined]) {
    assert.equal(parseServerTarget(input), undefined, String(input));
  }
});

test("connect strings and URLs", () => {
  assert.equal(connectString({ kind: "join", code: "3lamjz" }), "cfx.re/join/3lamjz");
  assert.equal(connectString({ kind: "endpoint", host: "1.2.3.4", port: 30120 }), "1.2.3.4:30120");
  assert.equal(connectString({ kind: "endpoint", host: "::1", port: 30120 }), "[::1]:30120");
  assert.equal(endpointBaseUrl("::1", 30120), "http://[::1]:30120");
  assert.equal(endpointBaseUrl("localhost", 30120), "http://localhost:30120");
  assert(isLoopbackHost("127.0.0.1") && isLoopbackHost("localhost") && isLoopbackHost("::1"));
  assert(!isLoopbackHost("10.0.0.1"));
});
