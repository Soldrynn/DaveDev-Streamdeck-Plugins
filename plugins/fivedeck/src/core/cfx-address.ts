/**
 * Parses the many ways people share a FiveM server — join codes, cfx.re links, server-list links,
 * `fivem://` links, pasted F8 `connect` commands, and plain `host:port` endpoints — into one shape.
 */

export const DEFAULT_GAME_PORT = 30120;

export type ServerTarget =
  | { kind: "join"; code: string }
  | { kind: "endpoint"; host: string; port: number };

const JOIN_CODE = /^[a-z0-9]{4,12}$/i;
const JOIN_URL = /^(?:https?:\/\/)?(?:www\.)?cfx\.re\/join\/([a-z0-9]{4,12})\/?(?:[?#].*)?$/i;
const SERVER_LIST_URL = /^(?:https?:\/\/)?(?:servers\.fivem\.net|servers\.redm\.net|cfx\.re)\/servers\/detail\/([a-z0-9]{4,12})\/?(?:[?#].*)?$/i;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function parseServerTarget(input: unknown): ServerTarget | undefined {
  if (typeof input !== "string") return undefined;
  let value = input.trim();
  if (!value) return undefined;

  value = value.replace(/^connect\s+/i, "").replace(/^["']|["']$/g, "").trim();
  value = value.replace(/^(?:fivem|redm):\/\/connect\//i, "");

  const joinUrl = JOIN_URL.exec(value) ?? SERVER_LIST_URL.exec(value);
  if (joinUrl) return { kind: "join", code: joinUrl[1].toLowerCase() };

  value = value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  // A bare word is a join code; LAN machines without a dotted name need an explicit ":port".
  if (JOIN_CODE.test(value) && !/^localhost$/i.test(value)) return { kind: "join", code: value.toLowerCase() };
  return parseEndpoint(value);
}

function parseEndpoint(value: string): ServerTarget | undefined {
  let host: string;
  let portText: string | undefined;
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d+))?$/i.exec(value);
  if (bracketed) {
    host = bracketed[1];
    portText = bracketed[2];
  } else {
    const parts = value.split(":");
    if (parts.length > 2) return undefined;
    host = parts[0];
    portText = parts[1];
  }
  if (!host) return undefined;
  if (!bracketed && !IPV4.test(host) && (!HOSTNAME.test(host) || /^[\d.]+$/.test(host))) return undefined;
  // A dotless word without a port is more likely a mistyped join code than a LAN machine name.
  if (!bracketed && portText === undefined && !host.includes(".") && !/^localhost$/i.test(host)) return undefined;
  const port = portText === undefined ? DEFAULT_GAME_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { kind: "endpoint", host: host.toLowerCase(), port };
}

/** The string FiveM's `connect` command and `fivem://connect/` links accept. */
export function connectString(target: ServerTarget): string {
  if (target.kind === "join") return `cfx.re/join/${target.code}`;
  return `${target.host.includes(":") ? `[${target.host}]` : target.host}:${target.port}`;
}

/** Base URL of the server's own HTTP endpoints (info.json, dynamic.json, players.json). */
export function endpointBaseUrl(host: string, port: number): string {
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}
