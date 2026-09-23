/**
 * Talks to a running FiveM client without a FiveM resource.
 *
 * The bridge: FiveM runs key-bound commands with full console rights, and its `exec` command reads
 * files from `fxd:/`, which is %APPDATA%\CitizenFX. FiveDeck binds one key nobody owns (F24 by
 * default) to `exec fxd:/fivedeck.cfg`, writes the commands for each press into that file, and taps
 * the key. The game runs them on the next frame: no chat box, no console, any number of commands,
 * `wait` included. The bind is installed once — into fivem.cfg while the game is closed, or by
 * typing it into F8 (where `bind` is allowed even on production clients) the first time it's needed.
 *
 * Console and chat transports type into F8 or the chat box instead. Every keystroke is guarded:
 * input is only sent while a FiveM/RedM window is in the foreground, so a press can never type a
 * command into another application.
 */
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { connectString, type ServerTarget } from "./cfx-address.ts";
import { chordStrokes, findKey, type KeyDefinition, type Modifier } from "./keys.ts";
import type { InputSettings, Transport } from "./settings.ts";
import { consoleCommand } from "./text.ts";
import type { NativeInput, ProcessInfo } from "./win32.ts";

export const GAME_PROCESS = /^(?:FiveM|RedM)_.*(?:GTA|Game)Process\.exe$/i;
export const BRIDGE_FILE = "fivedeck.cfg";
export const BRIDGE_EXEC = `exec fxd:/${BRIDGE_FILE}`;
const BRIDGE_IDLE = "// FiveDeck bridge: idle\n";
const BRIDGE_CLEAR_MS = 3_000;
const MAX_TYPED_LENGTH = 400;

export type DispatchFailure = "no-native" | "not-running" | "not-focused" | "bridge-conflict" | "bridge-missing" | "empty" | "input-rejected";

export class DispatchError extends Error {
  readonly reason: DispatchFailure;
  constructor(reason: DispatchFailure, message: string) {
    super(message);
    this.name = "DispatchError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------------------------

/** The bind command as typed into F8. */
export function bindCommand(keyName: string): string {
  return `bind keyboard ${keyName} "${BRIDGE_EXEC}"`;
}

/** The bind line in the format FiveM itself writes to fivem.cfg. */
export function bindConfigLine(keyName: string): string {
  return `bind KEYBOARD ${keyName.toUpperCase()} "${BRIDGE_EXEC}"`;
}

export type BindState = "installed" | "missing" | "conflict";

/** Reads fivem.cfg and reports whether the bridge key is bound to the bridge, free, or taken. */
export function bindState(configText: string, keyName: string): { state: BindState; existing?: string } {
  const key = keyName.toUpperCase();
  for (const line of configText.split(/\r?\n/)) {
    const match = /^\s*bind\s+"?keyboard"?\s+"?([A-Za-z0-9_]+)"?\s+(.*)$/i.exec(line);
    if (!match || match[1].toUpperCase() !== key) continue;
    const command = match[2].trim().replace(/^"(.*)"$/, "$1").trim();
    return command.toLowerCase() === BRIDGE_EXEC ? { state: "installed" } : { state: "conflict", existing: command };
  }
  return { state: "missing" };
}

/** Adds the bridge bind after `unbindall` (FiveM clears binds there) or at the end of the file. */
export function withBridgeBind(configText: string, keyName: string): string {
  const line = bindConfigLine(keyName);
  const newline = configText.includes("\r\n") ? "\r\n" : "\n";
  const lines = configText.length ? configText.split(/\r?\n/) : [];
  const unbindAll = lines.findIndex(entry => /^\s*unbindall\s*$/i.test(entry));
  if (unbindAll >= 0) lines.splice(unbindAll + 1, 0, line);
  else {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(line);
  }
  const text = lines.join(newline);
  return text.endsWith(newline) ? text : text + newline;
}

/** Hold mode: on release, `+command` lines become `-command`; other lines don't repeat. */
export function releaseLines(lines: readonly string[]): string[] {
  return lines.filter(line => line.startsWith("+")).map(line => `-${line.slice(1).split(/\s+/)[0]}`);
}

/** Commands sent through chat need a leading slash; console and bridge commands must not have one. */
export function chatLine(line: string): string {
  return line.startsWith("/") ? line : `/${line}`;
}

/** Makes a line safe to type: one line, bounded length. */
export function typedText(line: string): string {
  return line.replace(/[\r\n]+/g, " ").slice(0, MAX_TYPED_LENGTH);
}

export function fivemUri(target: ServerTarget): string {
  return `fivem://connect/${connectString(target)}`;
}

// ---------------------------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------------------------

export interface GameDependencies {
  native: () => Promise<NativeInput | undefined>;
  settings: () => InputSettings;
  log: (message: string) => void;
  appData?: string;
  localAppData?: string;
  sleep?: (ms: number) => Promise<void>;
  /** How long a process snapshot is reused; several keys refresh their state together. */
  processCacheMs?: number;
}

export interface GameStatus {
  running: boolean;
  focused: boolean;
  pids: number[];
}

export class GameController {
  readonly #deps: GameDependencies;
  readonly #sleep: (ms: number) => Promise<void>;
  #queue: Promise<unknown> = Promise.resolve();
  #clearTimer: NodeJS.Timeout | undefined;
  /** Game process IDs for which the bind was typed into F8 during this session. */
  readonly #installedFor = new Set<number>();
  #processCache: { at: number; list: ProcessInfo[] } | undefined;

  constructor(deps: GameDependencies) {
    this.#deps = deps;
    this.#sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  get citizenDirectory(): string {
    return join(this.#deps.appData ?? process.env.APPDATA ?? "", "CitizenFX");
  }

  get bridgeFile(): string {
    return join(this.citizenDirectory, BRIDGE_FILE);
  }

  get configFile(): string {
    return join(this.citizenDirectory, "fivem.cfg");
  }

  /** Runs `task` after every earlier input task, so presses never interleave keystrokes. */
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #processes(native: NativeInput): Promise<ProcessInfo[]> {
    const now = Date.now();
    if (this.#processCache && now - this.#processCache.at < (this.#deps.processCacheMs ?? 1_500)) return this.#processCache.list;
    const list = native.processes();
    this.#processCache = { at: now, list };
    return list;
  }

  async status(): Promise<GameStatus> {
    const native = await this.#deps.native();
    if (!native) return { running: false, focused: false, pids: [] };
    const pids = (await this.#processes(native)).filter(entry => GAME_PROCESS.test(entry.name)).map(entry => entry.pid);
    const foreground = native.foregroundProcess();
    return { running: pids.length > 0, focused: Boolean(foreground && GAME_PROCESS.test(foreground.name)), pids };
  }

  /** Resolves native input and makes sure the game owns the foreground window. */
  async #prepare(): Promise<{ native: NativeInput; settings: InputSettings; status: GameStatus }> {
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
    return { native, settings, status };
  }

  #tap(native: NativeInput, settings: InputSettings, keyName: string): void {
    const key = findKey(keyName);
    if (!key) throw new DispatchError("input-rejected", `Unknown key ${keyName}.`);
    if (!native.send(chordStrokes(key), settings.scanCodeOnly)) throw new DispatchError("input-rejected", "Windows rejected the synthetic key press.");
  }

  #type(native: NativeInput, text: string): void {
    if (!native.typeText(typedText(text))) throw new DispatchError("input-rejected", "Windows rejected the typed text.");
  }

  /** Runs console commands through the chosen transport. */
  run(lines: readonly string[], transport: Transport): Promise<void> {
    const commands = lines.map(consoleCommand).filter(Boolean);
    if (commands.length === 0) return Promise.reject(new DispatchError("empty", "There's no command to run."));
    return this.#serial(async () => {
      const context = await this.#prepare();
      if (transport === "bridge") await this.#runBridge(context, commands);
      else if (transport === "console") await this.#runConsole(context, commands);
      else await this.#runChat(context, commands.map(chatLine), true);
    });
  }

  /** Types a chat message (not a command). With `send` false the chat box is left open to edit. */
  chat(message: string, send: boolean): Promise<void> {
    if (!message.trim()) return Promise.reject(new DispatchError("empty", "The message is empty."));
    return this.#serial(async () => {
      const context = await this.#prepare();
      await this.#runChat(context, [message], send);
    });
  }

  /** Presses, holds, or releases a key chord in the game. */
  key(key: KeyDefinition, modifiers: readonly Modifier[], phase: "tap" | "down" | "up"): Promise<void> {
    return this.#serial(async () => {
      if (phase === "up") {
        // Always release, even if focus moved, so no key is left stuck down.
        const native = await this.#deps.native();
        native?.send(chordStrokes(key, modifiers, "up"), this.#deps.settings().scanCodeOnly);
        return;
      }
      const { native, settings } = await this.#prepare();
      if (!native.send(chordStrokes(key, modifiers, phase), settings.scanCodeOnly)) {
        throw new DispatchError("input-rejected", "Windows rejected the synthetic key press.");
      }
    });
  }

  async #runBridge(context: { native: NativeInput; settings: InputSettings; status: GameStatus }, commands: string[]): Promise<void> {
    const { native, settings, status } = context;
    await this.#ensureBridge(native, settings, status);
    await this.#writeBridge(commands.join("\n") + "\n");
    this.#tap(native, settings, settings.bridgeKey);
    // Give the game a frame or two to read the file before anything can overwrite it.
    await this.#sleep(Math.max(120, settings.inputDelayMs));
    this.#scheduleClear();
  }

  async #ensureBridge(native: NativeInput, settings: InputSettings, status: GameStatus): Promise<void> {
    if (status.pids.some(pid => this.#installedFor.has(pid))) return;
    const current = bindState(await readFile(this.configFile, "utf8").catch(() => ""), settings.bridgeKey);
    if (current.state === "conflict") {
      throw new DispatchError("bridge-conflict", `${settings.bridgeKey} is already bound to "${current.existing}" in FiveM. Pick another bridge key in FiveDeck's settings.`);
    }
    if (current.state === "missing" && !settings.autoBridge) {
      throw new DispatchError("bridge-missing", `Type ${bindCommand(settings.bridgeKey)} into F8 once, or turn on automatic bridge setup in FiveDeck.`);
    }
    if (current.state === "missing") {
      this.#deps.log(`Installing the FiveDeck bridge bind on ${settings.bridgeKey} through the F8 console.`);
      await this.#runConsole({ native, settings }, [bindCommand(settings.bridgeKey)]);
      await this.#sleep(settings.inputDelayMs);
    }
    for (const pid of status.pids) this.#installedFor.add(pid);
  }

  async #writeBridge(content: string): Promise<void> {
    clearTimeout(this.#clearTimer);
    await mkdir(this.citizenDirectory, { recursive: true });
    const temporary = `${this.bridgeFile}.tmp`;
    await writeFile(temporary, content, "utf8");
    try {
      await rename(temporary, this.bridgeFile);
    } catch (error) {
      // FiveM may be reading the file at this instant; Windows then refuses the replace briefly.
      if (!["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await this.#sleep(40);
      await rename(temporary, this.bridgeFile);
    }
  }

  /** Blanks the bridge file shortly after use so a stray F24 press can't replay old commands. */
  #scheduleClear(): void {
    clearTimeout(this.#clearTimer);
    this.#clearTimer = setTimeout(() => {
      void this.#serial(() => this.#writeBridge(BRIDGE_IDLE)).catch(() => undefined);
    }, BRIDGE_CLEAR_MS);
    this.#clearTimer.unref?.();
  }

  async #runConsole(context: { native: NativeInput; settings: InputSettings }, commands: string[]): Promise<void> {
    const { native, settings } = context;
    this.#tap(native, settings, settings.consoleKey);
    await this.#sleep(settings.inputDelayMs);
    for (const command of commands) {
      this.#type(native, command);
      this.#tap(native, settings, "RETURN");
      await this.#sleep(40);
    }
    this.#tap(native, settings, settings.consoleKey);
  }

  async #runChat(context: { native: NativeInput; settings: InputSettings }, lines: string[], send: boolean): Promise<void> {
    const { native, settings } = context;
    for (const [index, line] of lines.entries()) {
      if (index > 0) await this.#sleep(settings.inputDelayMs);
      this.#tap(native, settings, settings.chatKey);
      await this.#sleep(Math.round(settings.inputDelayMs * 1.5));
      this.#type(native, line);
      if (send) this.#tap(native, settings, "RETURN");
    }
  }

  // -------------------------------------------------------------------------------------------
  // Offline bridge install and launching
  // -------------------------------------------------------------------------------------------

  /**
   * While the game is closed, writes the bridge bind straight into fivem.cfg (after a one-time
   * backup). FiveM rewrites that file while it runs, so this never touches it then.
   */
  async installBridgeOffline(): Promise<BindState | "game-running" | "no-config"> {
    const settings = this.#deps.settings();
    if ((await this.status()).running) return "game-running";
    if (!existsSync(this.citizenDirectory)) return "no-config";
    const text = await readFile(this.configFile, "utf8").catch(() => "");
    const current = bindState(text, settings.bridgeKey);
    if (current.state !== "missing") return current.state;
    const backup = `${this.configFile}.fivedeck-backup`;
    if (text && !existsSync(backup)) await copyFile(this.configFile, backup);
    await writeFile(this.configFile, withBridgeBind(text, settings.bridgeKey), "utf8");
    this.#deps.log(`Added the FiveDeck bridge bind (${settings.bridgeKey}) to ${this.configFile}.`);
    return "installed";
  }

  #offlineCheckedFor = "";

  /** Installs the bind in fivem.cfg soon after a bridge key appears, if the game is closed. */
  ensureBridgeSoon(): void {
    const settings = this.#deps.settings();
    if (!settings.autoBridge || process.platform !== "win32" || this.#offlineCheckedFor === settings.bridgeKey) return;
    this.#offlineCheckedFor = settings.bridgeKey;
    const timer = setTimeout(() => {
      this.installBridgeOffline().then(
        result => this.#deps.log(`Bridge bind check (${settings.bridgeKey}): ${result}.`),
        error => this.#deps.log(`Bridge bind check failed: ${String(error)}`)
      );
    }, 1_500);
    timer.unref?.();
  }

  async bridgeState(): Promise<BindState> {
    const text = await readFile(this.configFile, "utf8").catch(() => "");
    return bindState(text, this.#deps.settings().bridgeKey).state;
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
    const uri = fivemUri(target);
    const status = await this.status();
    if (!(await this.launch([uri]))) return "no-fivem";
    if (!status.running) return "launched";
    if (!switchNow) return "sent";
    await this.#sleep(400);
    try {
      // `disconnect` is on the production F8 whitelist, so this works without the bridge.
      await this.run(["disconnect"], "console");
      return "switching";
    } catch (error) {
      this.#deps.log(`Server switch fell back to a queued join: ${String(error)}`);
      return "sent";
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
