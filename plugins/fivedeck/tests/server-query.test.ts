import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactVerdict, parseArtifactVersions, parseBuild, queryEndpoint, queryJoinCode, snapshotFromList, type FetchLike } from "../src/core/server-query.ts";

function fakeFetch(routes: Record<string, { status?: number; body?: unknown; headers?: Record<string, string> } | Error>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!route) throw new TypeError("fetch failed");
    if (route instanceof Error) throw route;
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: route.headers });
  };
  return Object.assign(impl, { calls });
}

test("parses FXServer version strings", () => {
  assert.equal(parseBuild("FXServer-master SERVER v1.0.0.17000 win32"), 17000);
  assert.equal(parseBuild("FXServer-feature/x v1.0.0.9999 linux"), 9999);
  assert.equal(parseBuild("nope"), undefined);
  assert.equal(parseBuild(undefined), undefined);
});

test("reads a local server from dynamic.json and info.json", async () => {
  const fetch = fakeFetch({
    "http://127.0.0.1:30120/dynamic.json": { body: { hostname: "^2Dev ^7Server", clients: 3, sv_maxclients: "48", gametype: "", mapname: "" } },
    "http://127.0.0.1:30120/info.json": { body: { server: "FXServer-master SERVER v1.0.0.17000 win32", resources: ["hardcap", "mapmanager"], vars: { sv_projectName: "^1Dave's ^7Lab" } } }
  });
  const snapshot = await queryEndpoint("127.0.0.1", 30120, fetch);
  assert.equal(snapshot.online, true);
  assert.equal(snapshot.name, "Dave's Lab");
  assert.equal(snapshot.players, 3);
  assert.equal(snapshot.maxPlayers, 48);
  assert.equal(snapshot.build, 17000);
  assert.equal(snapshot.resources, 2);
  assert.equal(snapshot.connect, "127.0.0.1:30120");
});

test("an unreachable endpoint is offline", async () => {
  const snapshot = await queryEndpoint("127.0.0.1", 30120, fakeFetch({}));
  assert.equal(snapshot.online, false);
  assert(snapshot.error);
});

test("server list entries", () => {
  const snapshot = snapshotFromList("abc123", { EndPoint: "abc123", Data: { hostname: "^5Big ^7RP", clients: 120, sv_maxclients: 128, server: "FXServer-master v1.0.0.16000 win32", vars: {} } }, 1);
  assert.deepEqual(snapshot, { online: true, name: "Big RP", players: 120, maxPlayers: 128, build: 16000, resources: undefined, connect: "cfx.re/join/abc123", checkedAt: 1 });
  assert.equal(snapshotFromList("abc123", {}), undefined);
});

test("join codes fall back from the list API to the cfx.re/join header", async () => {
  const fetch = fakeFetch({
    "https://frontend.cfx-services.net/": { status: 403 },
    "https://servers-frontend.fivem.net/": { status: 403 },
    "https://cfx.re/join/zzz999": { status: 200, headers: { "x-citizenfx-url": "http://10.1.2.3:30125/" } },
    "http://10.1.2.3:30125/dynamic.json": { body: { hostname: "Resolved", clients: 1, sv_maxclients: "10" } },
    "http://10.1.2.3:30125/info.json": { status: 404 }
  });
  const snapshot = await queryJoinCode("zzz999", fetch);
  assert.equal(snapshot.online, true);
  assert.equal(snapshot.name, "Resolved");
  assert.equal(snapshot.connect, "cfx.re/join/zzz999");
});

test("private join codes with a blocked list API are unknown, not offline", async () => {
  const fetch = fakeFetch({
    "https://frontend.cfx-services.net/": { status: 403 },
    "https://servers-frontend.fivem.net/": { status: 403 },
    "https://cfx.re/join/priv01": { status: 200, headers: { "x-citizenfx-url": "https://private-placeholder.cfx.re/" } }
  });
  const snapshot = await queryJoinCode("priv01", fetch);
  assert.equal(snapshot.online, undefined);
});

test("artifact feed parsing and verdicts", () => {
  const versions = parseArtifactVersions({
    recommended: "17000", optional: "17100", latest: "17250", critical: "15000",
    recommended_download: "https://runtime.fivem.net/artifacts/fivem/build_server_windows/master/17000-abc/server.7z",
    latest_download: "https://runtime.fivem.net/artifacts/fivem/build_server_windows/master/17250-def/server.7z"
  });
  assert.equal(versions.latest, 17250);
  assert.equal(artifactVerdict(14000, versions), "critical");
  assert.equal(artifactVerdict(16500, versions), "outdated");
  assert.equal(artifactVerdict(17000, versions), "current");
  assert.equal(artifactVerdict(17250, versions), "ahead");
  assert.equal(artifactVerdict(undefined, versions), "unknown");
  assert.throws(() => parseArtifactVersions({ recommended: "x" }), /recommended/);
});
