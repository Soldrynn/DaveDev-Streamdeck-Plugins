/**
 * Live server status. Endpoints are read straight from FXServer's own HTTP API (`/dynamic.json`
 * for name and player count, `/info.json` for the project name and build). Join codes go through
 * the Cfx server list first and fall back to resolving the code to an endpoint through
 * `cfx.re/join`, the same header the FiveM client itself reads.
 */
import { connectString, endpointBaseUrl, parseServerTarget, type ServerTarget } from "./cfx-address.ts";
import { stripCfxFormatting } from "./text.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ServerSnapshot {
  /** true = answering, false = confirmed down, undefined = couldn't tell (e.g. list API blocked). */
  online: boolean | undefined;
  name: string;
  players?: number;
  maxPlayers?: number;
  /** FXServer build number parsed from the version string. */
  build?: number;
  resources?: number;
  connect: string;
  checkedAt: number;
  error?: string;
}

const USER_AGENT = "FiveDeck (Stream Deck plugin; +https://github.com/Soldrynn/DaveDev-Streamdeck-Plugins)";
const LIST_APIS = [
  "https://frontend.cfx-services.net/api/servers/single/",
  "https://servers-frontend.fivem.net/api/servers/single/"
];
const PRIVATE_PLACEHOLDER = "https://private-placeholder.cfx.re/";
const RESOLVE_TTL_MS = 10 * 60_000;
const resolvedJoinCodes = new Map<string, { target: ServerTarget; expiresAt: number }>();

export function parseBuild(version: unknown): number | undefined {
  if (typeof version !== "string") return undefined;
  const match = /v\d+\.\d+\.\d+\.(\d+)/.exec(version);
  return match ? Number(match[1]) : undefined;
}

function toCount(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value.trim()) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

function toName(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const name = stripCfxFormatting(candidate).slice(0, 200);
      if (name) return name;
    }
  }
  return "";
}

async function getJson(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<{ status: number; body?: any }> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { status: response.status };
  }
  const text = await response.text();
  if (text.length > 2_000_000) return { status: 413 };
  return { status: response.status, body: JSON.parse(text) };
}

export async function queryEndpoint(host: string, port: number, fetchImpl: FetchLike = fetch, timeoutMs = 3_000): Promise<ServerSnapshot> {
  const base = endpointBaseUrl(host, port);
  const connect = connectString({ kind: "endpoint", host, port });
  const checkedAt = Date.now();
  const [dynamic, info] = await Promise.allSettled([
    getJson(fetchImpl, `${base}/dynamic.json`, timeoutMs),
    getJson(fetchImpl, `${base}/info.json`, timeoutMs)
  ]);
  const dynamicBody = dynamic.status === "fulfilled" ? dynamic.value.body : undefined;
  const infoBody = info.status === "fulfilled" ? info.value.body : undefined;
  if (!dynamicBody && !infoBody) {
    const reason = dynamic.status === "rejected" ? String(dynamic.reason?.cause?.code ?? dynamic.reason?.name ?? dynamic.reason) : `HTTP ${dynamic.value.status}`;
    return { online: false, name: "", connect, checkedAt, error: reason };
  }
  return {
    online: true,
    name: toName(infoBody?.vars?.sv_projectName, dynamicBody?.hostname),
    players: toCount(dynamicBody?.clients),
    maxPlayers: toCount(dynamicBody?.sv_maxclients ?? infoBody?.vars?.sv_maxClients),
    build: parseBuild(infoBody?.server),
    resources: Array.isArray(infoBody?.resources) ? infoBody.resources.length : undefined,
    connect,
    checkedAt
  };
}

/** Parses one server-list entry. Exported for tests. */
export function snapshotFromList(code: string, body: any, checkedAt = Date.now()): ServerSnapshot | undefined {
  const data = body?.Data ?? body?.data;
  if (!data || typeof data !== "object") return undefined;
  return {
    online: true,
    name: toName(data.vars?.sv_projectName, data.hostname),
    players: toCount(data.clients ?? (Array.isArray(data.players) ? data.players.length : undefined)),
    maxPlayers: toCount(data.sv_maxclients ?? data.svMaxclients ?? data.vars?.sv_maxClients),
    build: parseBuild(data.server),
    resources: Array.isArray(data.resources) ? data.resources.length : undefined,
    connect: connectString({ kind: "join", code }),
    checkedAt
  };
}

/** Resolves a join code to its real endpoint through the `X-CitizenFX-Url` header, when public. */
export async function resolveJoinCode(code: string, fetchImpl: FetchLike = fetch): Promise<ServerTarget | undefined> {
  const cached = resolvedJoinCodes.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.target;
  const response = await fetchImpl(`https://cfx.re/join/${code}`, {
    redirect: "manual",
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(4_000)
  });
  await response.body?.cancel();
  const header = response.headers.get("x-citizenfx-url");
  if (!header || header === PRIVATE_PLACEHOLDER) return undefined;
  let url: URL;
  try {
    url = new URL(header);
  } catch {
    return undefined;
  }
  const target = parseServerTarget(`${url.hostname}${url.port ? `:${url.port}` : ""}`);
  if (target?.kind !== "endpoint") return undefined;
  resolvedJoinCodes.set(code, { target, expiresAt: Date.now() + RESOLVE_TTL_MS });
  return target;
}

export async function queryJoinCode(code: string, fetchImpl: FetchLike = fetch): Promise<ServerSnapshot> {
  const connect = connectString({ kind: "join", code });
  let notListed = false;
  for (const api of LIST_APIS) {
    try {
      const result = await getJson(fetchImpl, `${api}${encodeURIComponent(code)}`, 4_000);
      if (result.status === 404) notListed = true;
      const snapshot = result.body ? snapshotFromList(code, result.body) : undefined;
      if (snapshot) return snapshot;
    } catch {
      // Try the next source.
    }
  }
  try {
    const endpoint = await resolveJoinCode(code, fetchImpl);
    if (endpoint?.kind === "endpoint") {
      const snapshot = await queryEndpoint(endpoint.host, endpoint.port, fetchImpl);
      return { ...snapshot, connect };
    }
  } catch {
    // Fall through to "unknown".
  }
  return {
    online: notListed ? false : undefined,
    name: "",
    connect,
    checkedAt: Date.now(),
    error: notListed ? "Not in the server list" : "Status unavailable"
  };
}

export function queryServer(target: ServerTarget, fetchImpl: FetchLike = fetch): Promise<ServerSnapshot> {
  return target.kind === "join" ? queryJoinCode(target.code, fetchImpl) : queryEndpoint(target.host, target.port, fetchImpl);
}

export interface ArtifactVersions {
  recommended: number;
  optional: number;
  latest: number;
  critical: number;
  recommendedDownload: string;
  latestDownload: string;
}

/** The same versions feed txAdmin uses to flag outdated FXServer builds. */
export async function fetchArtifactVersions(platform: "win32" | "linux" = "win32", fetchImpl: FetchLike = fetch): Promise<ArtifactVersions> {
  const cacheBuster = Math.floor(Date.now() / 5_000_000);
  const result = await getJson(fetchImpl, `https://changelogs-live.fivem.net/api/changelog/versions/${platform}/server?${cacheBuster}`, 6_000);
  return parseArtifactVersions(result.body);
}

export function parseArtifactVersions(body: any): ArtifactVersions {
  const number = (value: unknown, field: string) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Artifact feed field ${field} is invalid.`);
    return parsed;
  };
  const url = (value: unknown, field: string) => {
    if (typeof value !== "string" || !/^https:\/\//.test(value)) throw new Error(`Artifact feed field ${field} is invalid.`);
    return value;
  };
  return {
    recommended: number(body?.recommended, "recommended"),
    optional: number(body?.optional, "optional"),
    latest: number(body?.latest, "latest"),
    critical: number(body?.critical, "critical"),
    recommendedDownload: url(body?.recommended_download, "recommended_download"),
    latestDownload: url(body?.latest_download, "latest_download")
  };
}

export type ArtifactVerdict = "critical" | "outdated" | "current" | "ahead" | "unknown";

/** Mirrors txAdmin: below critical is urgent, below recommended is outdated. */
export function artifactVerdict(build: number | undefined, versions: ArtifactVersions): ArtifactVerdict {
  if (!build) return "unknown";
  if (build < versions.critical) return "critical";
  if (build < versions.recommended) return "outdated";
  if (build > versions.recommended) return "ahead";
  return "current";
}
