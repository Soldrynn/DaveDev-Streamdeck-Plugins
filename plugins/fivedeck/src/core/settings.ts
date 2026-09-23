/**
 * Typed views over FiveDeck's settings. Per-key settings arrive untrusted from the property
 * inspector (and from shared profiles), so every reader clamps and defaults its values here.
 * Secrets (RCON passwords) live only in global settings, which Stream Deck never exports with a
 * profile.
 */

export type Transport = "bridge" | "console" | "chat";

export interface GlobalSettings {
  [key: string]: unknown;
  bridgeKey?: string;
  consoleKey?: string;
  chatKey?: string;
  inputDelayMs?: number;
  scanCodeOnly?: boolean;
  focusGame?: boolean;
  fivemPath?: string;
  autoBridge?: boolean;
  servers?: Record<string, ServerSlot | undefined>;
}

export interface ServerSlot {
  name?: string;
  host?: string;
  port?: number | string;
  password?: string;
}

export const SERVER_SLOTS = ["s1", "s2", "s3"] as const;
export type ServerSlotId = (typeof SERVER_SLOTS)[number];

export interface InputSettings {
  bridgeKey: string;
  consoleKey: string;
  chatKey: string;
  inputDelayMs: number;
  scanCodeOnly: boolean;
  focusGame: boolean;
  fivemPath: string;
  /** Install the bridge bind automatically (fivem.cfg while closed, F8 while running). */
  autoBridge: boolean;
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** The bridge key must be one no keyboard has, so FiveDeck never hijacks a key someone presses. */
const BRIDGE_KEYS = /^F(?:1[3-9]|2[0-4])$/;

export function inputSettings(global: GlobalSettings): InputSettings {
  const bridgeKey = str(global.bridgeKey).toUpperCase();
  return {
    bridgeKey: BRIDGE_KEYS.test(bridgeKey) ? bridgeKey : "F24",
    consoleKey: str(global.consoleKey) || "F8",
    chatKey: str(global.chatKey) || "T",
    inputDelayMs: num(global.inputDelayMs, 90, 30, 600),
    scanCodeOnly: bool(global.scanCodeOnly),
    focusGame: bool(global.focusGame),
    fivemPath: str(global.fivemPath),
    autoBridge: bool(global.autoBridge, true)
  };
}

export interface ResolvedSlot {
  id: ServerSlotId;
  name: string;
  host: string;
  port: number;
  password: string;
}

export function serverSlot(global: GlobalSettings, id: unknown): ResolvedSlot {
  const slotId = oneOf(id, SERVER_SLOTS, "s1");
  const slot = global.servers?.[slotId] ?? {};
  return {
    id: slotId,
    name: str(slot.name) || `Server ${slotId.slice(1)}`,
    host: str(slot.host) || "127.0.0.1",
    port: num(slot.port, 30120, 1, 65535),
    password: str(slot.password)
  };
}
