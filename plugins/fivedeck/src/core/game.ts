/** Direct command dispatch plus explicit Chat Message/Game Key input on Windows. */
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { connectString, type ServerTarget } from "./cfx-address.ts";
import { DevConClient } from "./devcon.ts";
import { chordStrokes, findKey, type KeyDefinition, type Modifier } from "./keys.ts";
import type { InputSettings, Transport } from "./settings.ts";
import { consoleCommand } from "./text.ts";
import type { NativeInput, ProcessInfo } from "./win32.ts";

export const GAME_PROCESS = /^(?:FiveM|RedM)_.*(?:GTA|Game)Process\.exe$/i;

export type DispatchFailure = "no-native" | "not-running" | "not-focused" | "empty" | "input-rejected";
export class DispatchError extends Error {
  readonly reason: DispatchFailure;
  constructor(reason: DispatchFailure, message: string) { super(message); this.reason = reason; this.name = "DispatchError"; }
}
export function releaseLines(lines: readonly string[]): string[] {
  return lines.map(consoleCommand).filter(line => line.startsWith("+")).map(line => `-${line.slice(1).split(/\s+/)[0]}`);
}
export function typedText(line: string): string { return line.replace(/[\r\n]+/g, " ").slice(0, 400); }
export function fivemUri(target: ServerTarget): string { return `fivem://connect/${connectString(target)}`; }
export interface GameDependencies {
  native: () => Promise<NativeInput | undefined>;
  settings: () => InputSettings;
  log: (message: string) => void;
  appData?: string;
  localAppData?: string;
  sleep?: (ms: number) => Promise<void>;
  processCacheMs?: number;
  connection?: DevConClient;
}
export interface GameStatus { running: boolean; focused: boolean; pids: number[]; }

export class GameController {
  readonly connection: DevConClient;
  readonly #deps: GameDependencies;
  readonly #sleep: (ms: number) => Promise<void>;
  #queue: Promise<unknown> = Promise.resolve();
  #processCache: { at: number; list: ProcessInfo[] } | undefined;
  #disposed = false;
  readonly #held = new Map<string, { native: NativeInput; key: KeyDefinition; modifiers: readonly Modifier[]; scan: boolean }>();
  constructor(deps: GameDependencies) {
    this.#deps = deps;
    this.#sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.connection = deps.connection ?? new DevConClient({ instance: () => deps.settings().clientInstance });
  }
  dispose(): void {
    this.#disposed = true;
    this.connection.dispose();
    for (const held of this.#held.values()) held.native.send(chordStrokes(held.key, held.modifiers, "up"), held.scan);
    this.#held.clear();
  }
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(() => {
      if (this.#disposed) throw new DispatchError("input-rejected", "FiveDeck is closing.");
      return task();
    });
    this.#queue = next.catch(() => undefined);
    return next;
  }
  async status(fresh = false): Promise<GameStatus> {
    const native = await this.#deps.native();
    if (!native) return { running: false, focused: false, pids: [] };
    const now = Date.now();
    if (fresh || !this.#processCache || now - this.#processCache.at >= (this.#deps.processCacheMs ?? 1500)) {
      this.#processCache = { at: now, list: native.processes() };
    }
    const pids = this.#processCache.list.filter(entry => GAME_PROCESS.test(entry.name)).map(entry => entry.pid);
    const foreground = native.foregroundProcess();
    return { running: pids.length > 0, focused: Boolean(foreground && GAME_PROCESS.test(foreground.name)), pids };
  }
  #guard(native: NativeInput): void {
    if (this.#disposed || !GAME_PROCESS.test(native.foregroundProcess()?.name ?? "")) {
      throw new DispatchError("not-focused", "FiveM is no longer the active window. No further text was sent.");
    }
  }
  async #prepare(): Promise<{ native: NativeInput; settings: InputSettings }> {
    const native = await this.#deps.native();
    if (!native) throw new DispatchError("no-native", "Keyboard input is only available on Windows.");
    const settings = this.#deps.settings();
    let status = await this.status();
    if (!status.running) throw new DispatchError("not-running", "FiveM isn't running.");
    if (!status.focused && settings.focusGame) {
      native.focusProcessWindow(status.pids);
      await this.#sleep(250);
      status = await this.status();
    }
    if (!status.focused) throw new DispatchError("not-focused", "FiveM isn't the active window, so FiveDeck didn't send any keys.");
    return { native, settings };
  }
  async #tap(native: NativeInput, settings: InputSettings, keyName: string): Promise<void> {
    const key = findKey(keyName);
    if (!key) throw new DispatchError("input-rejected", `Unknown key ${keyName}.`);
    this.#guard(native);
    try {
      if (!native.send(chordStrokes(key, [], "down"), settings.scanCodeOnly)) throw new DispatchError("input-rejected", "Windows rejected the key press.");
      await this.#sleep(Math.max(50, settings.inputDelayMs));
    } finally { native.send(chordStrokes(key, [], "up"), settings.scanCodeOnly); }
  }
  /** Old per-key transport selections are deliberately ignored: commands never type into a UI. */
  run(lines: readonly string[], _transport?: Transport): Promise<void> {
    const commands = lines.map(consoleCommand).filter(Boolean);
    if (!commands.length) return Promise.reject(new DispatchError("empty", "There's no command to run."));
    return this.connection.send(commands);
  }
  chat(message: string, send: boolean): Promise<void> {
    if (!message.trim()) return Promise.reject(new DispatchError("empty", "The message is empty."));
    return this.#serial(async () => {
      const { native, settings } = await this.#prepare();
      await this.#tap(native, settings, settings.chatKey);
      await this.#sleep(Math.round(settings.inputDelayMs * 1.5));
      this.#guard(native);
      if (!native.typeText(typedText(message))) throw new DispatchError("input-rejected", "Windows rejected the typed text.");
      if (send) await this.#tap(native, settings, "RETURN");
    });
  }
  key(key: KeyDefinition, modifiers: readonly Modifier[], phase: "tap" | "down" | "up"): Promise<void> {
    const id = `${modifiers.join(",")}:${key.name}`;
    return this.#serial(async () => {
      if (phase === "up") {
        const held = this.#held.get(id);
        this.#held.delete(id);
        if (held) held.native.send(chordStrokes(held.key, held.modifiers, "up"), held.scan);
        return;
      }
      const { native, settings } = await this.#prepare();
      this.#guard(native);
      const held = { native, key, modifiers: [...modifiers], scan: settings.scanCodeOnly };
      this.#held.set(id, held);
      let sent = false;
      try {
        if (!native.send(chordStrokes(key, modifiers, "down"), settings.scanCodeOnly)) throw new DispatchError("input-rejected", "Windows rejected the key press.");
        sent = true;
        if (phase === "tap") await this.#sleep(Math.max(50, settings.inputDelayMs));
      } finally {
        if (phase === "tap" || !sent) { native.send(chordStrokes(key, modifiers, "up"), settings.scanCodeOnly); this.#held.delete(id); }
      }
    });
  }

  /** Finds FiveM.exe: the configured path, the default install, then the launcher's registry entry. */
  async fivemExecutable(): Promise<string | undefined> {
    const configured = this.#deps.settings().fivemPath;
    const candidates = [
      configured && (configured.toLowerCase().endsWith(".exe") ? configured : join(configured, "FiveM.exe")),
      join(this.#deps.localAppData ?? process.env.LOCALAPPDATA ?? "", "FiveM", "FiveM.exe")
    ].filter(Boolean) as string[];
    for (const candidate of candidates) if (existsSync(candidate)) return candidate;
    const registry = await lastRunLocation();
    if (registry) {
      for (const candidate of [registry, join(registry, "FiveM.exe"), join(dirname(registry), "FiveM.exe")]) {
        if (candidate.toLowerCase().endsWith(".exe") && existsSync(candidate) && (await stat(candidate)).isFile()) return candidate;
      }
    }
    return undefined;
  }

  /** Starts FiveM, optionally straight into a server. Returns false when FiveM.exe can't be found. */
  async launch(args: string[] = []): Promise<boolean> {
    const executable = await this.fivemExecutable();
    if (!executable) return false;
    const child = spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: false, shell: false });
    child.on("error", error => this.#deps.log(`FiveM launch failed: ${String(error)}`));
    child.unref();
    return true;
  }

  /**
   * Joins a server. A cold start passes the link on the command line (the same form FiveM uses to
   * restart itself). A running client receives the link over FiveM's own single-instance channel;
   * it connects from the main menu and holds the link while a session is loaded. `switchNow` then
   * sends `disconnect` so the held link takes over — a one-press server switch.
   */
  async join(target: ServerTarget, switchNow: boolean): Promise<"launched" | "sent" | "switching" | "no-fivem"> {
    if (this.connection.instance === "secondary") throw new Error("Join Server supports the primary client only. Select Primary in Game connection before joining.");
    const generation = this.connection.generation;
    const uri = fivemUri(target);
    const status = await this.status();
    if (generation !== this.connection.generation || this.connection.instance !== "primary") throw new Error("Client selection changed before joining. Press again.");
    if (!(await this.launch([uri]))) return "no-fivem";
    if (!status.running) return "launched";
    if (!switchNow) return "sent";
    await this.#sleep(400);
    if (generation !== this.connection.generation || this.connection.instance !== "primary") {
      throw new Error("The join link was sent, but the client selection changed. Leave the current server manually to complete the join.");
    }
    try {
      await this.run(["disconnect"]);
      return "switching";
    } catch (error) {
      throw new Error(`The join link was sent, but switching was not confirmed. Check in-game before trying again. ${String(error)}`);
    }
  }

  focus(): Promise<boolean> {
    return this.#serial(async () => {
      const native = await this.#deps.native();
      const status = await this.status();
      if (!native || !status.running) return false;
      return native.focusProcessWindow(status.pids);
    });
  }
}

function lastRunLocation(): Promise<string | undefined> {
  if (process.platform !== "win32") return Promise.resolve(undefined);
  return new Promise(resolve => {
    execFile("reg", ["query", "HKCU\\SOFTWARE\\CitizenFX\\FiveM", "/v", "Last Run Location"], { windowsHide: true, timeout: 3_000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      const match = /Last Run Location\s+REG_\w+\s+(.+)/i.exec(stdout);
      resolve(match ? match[1].trim().replace(/^"|"$/g, "") : undefined);
    });
  });
}
