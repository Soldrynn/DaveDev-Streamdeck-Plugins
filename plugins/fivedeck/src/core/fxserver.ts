/**
 * Supervises FXServer processes started from Stream Deck. A server runs either hidden, with
 * FiveDeck owning its console (graceful `quit`, commands over stdin, a rolling log, script-error
 * counting, txAdmin PIN capture), or in its own console window for people who want to type into it.
 *
 * FXServer treats end-of-file on stdin as Ctrl+C and quits, exactly like txAdmin relies on, so a
 * hidden server stops cleanly when Stream Deck (and with it this plugin) closes.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, existsSync, renameSync, statSync, type WriteStream } from "node:fs";
import { win32 } from "node:path";
import { cleanConsoleOutput } from "./rcon.ts";

export type FxServerStatus = "stopped" | "starting" | "running" | "stopping" | "crashed";
export type ConsoleMode = "hidden" | "window";

export interface FxServerConfig {
  executable: string;
  dataDirectory: string;
  /** `server.cfg` or similar; empty starts txAdmin instead. */
  configFile: string;
  extraArgs: string;
  consoleMode: ConsoleMode;
  gamePort: number;
  txAdminPort: number;
  autoRestart: boolean;
  logFile?: string;
}

export interface FxServerDependencies {
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  /** Resolves true when the URL answers HTTP at all. */
  probe: (url: string) => Promise<boolean>;
  exists: (path: string) => boolean;
  killTree: (pid: number) => void;
  now: () => number;
}

const MAX_LINES = 300;
const LOG_ROLL_BYTES = 5 * 1024 * 1024;
const STOP_GRACE_MS = 10_000;
const PROBE_INTERVAL_MS = 2_000;
const RESTART_WINDOW_MS = 5 * 60_000;
const MAX_RESTARTS = 3;
const SCRIPT_ERROR = /SCRIPT ERROR|\bError (?:loading|parsing) script\b|Couldn't start resource|Failed to load script/i;
const TXADMIN_PIN = /\bPIN\b\D{0,60}?(\d{4})\b/i;

/** Splits an argument string, honouring double quotes, without ever invoking a shell. */
export function splitArguments(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let pending = false;
  for (const character of value) {
    if (character === '"') {
      quoted = !quoted;
      pending = true;
    } else if (/\s/.test(character) && !quoted) {
      if (pending) args.push(current);
      current = "";
      pending = false;
    } else {
      current += character;
      pending = true;
    }
  }
  if (pending) args.push(current);
  return args;
}

export function validateConfig(config: FxServerConfig, exists: (path: string) => boolean): string | undefined {
  if (!config.executable) return "Choose FXServer.exe in the key settings.";
  if (win32.basename(config.executable).toLowerCase() !== "fxserver.exe") return "The server executable must be FXServer.exe.";
  if (!exists(config.executable)) return `FXServer.exe was not found at ${config.executable}.`;
  if (!config.dataDirectory) return "Choose the server data folder in the key settings.";
  if (!exists(config.dataDirectory)) return `The server data folder ${config.dataDirectory} does not exist.`;
  if (config.configFile && /[\r\n"]/.test(config.configFile)) return "The config file name contains invalid characters.";
  return undefined;
}

/** Without `+exec`, FXServer starts txAdmin (citizen:server:monitor) instead of a server. */
export function launchArguments(config: FxServerConfig): string[] {
  const args: string[] = [];
  if (config.configFile) args.push("+exec", config.configFile);
  args.push(...splitArguments(config.extraArgs));
  return args;
}

/** txAdmin reads its port from TXHOST_TXA_PORT; the old txAdminPort convar is deprecated. */
export function launchEnvironment(config: FxServerConfig, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (config.configFile || !config.txAdminPort || config.txAdminPort === 40120) return { ...base };
  return { ...base, TXHOST_TXA_PORT: String(config.txAdminPort) };
}

export class FxServerInstance extends EventEmitter {
  status: FxServerStatus = "stopped";
  startedAt = 0;
  exitCode: number | null = null;
  scriptErrors = 0;
  lastError = "";
  txAdminPin = "";
  lastFailure = "";
  readonly lines: string[] = [];

  #config: FxServerConfig | undefined;
  #child: ChildProcess | undefined;
  #log: WriteStream | undefined;
  #probeTimer: NodeJS.Timeout | undefined;
  #stopTimer: NodeJS.Timeout | undefined;
  #partial = "";
  #lineTotal = 0;
  #restarts: number[] = [];
  #stopRequested = false;
  readonly #deps: FxServerDependencies;

  constructor(deps: FxServerDependencies) {
    super();
    this.#deps = deps;
  }

  get pid(): number | undefined {
    return this.#child?.pid;
  }

  get config(): FxServerConfig | undefined {
    return this.#config;
  }

  get isActive(): boolean {
    return this.status === "starting" || this.status === "running" || this.status === "stopping";
  }

  /** True when commands can be written straight to the server console. */
  get acceptsInput(): boolean {
    return this.isActive && this.#config?.consoleMode === "hidden" && this.#child?.stdin?.writable === true;
  }

  start(config: FxServerConfig): string | undefined {
    if (this.isActive) return "The server is already running.";
    const invalid = validateConfig(config, this.#deps.exists);
    if (invalid) {
      this.lastFailure = invalid;
      this.#emit();
      return invalid;
    }
    this.#config = config;
    this.#stopRequested = false;
    this.scriptErrors = 0;
    this.lastError = "";
    this.txAdminPin = "";
    this.lastFailure = "";
    this.exitCode = null;
    this.lines.length = 0;
    this.#partial = "";
    this.#openLog(config.logFile);

    const hidden = config.consoleMode === "hidden";
    let child: ChildProcess;
    try {
      child = this.#deps.spawn(config.executable, launchArguments(config), {
        cwd: config.dataDirectory,
        env: launchEnvironment(config),
        windowsHide: hidden,
        detached: !hidden,
        stdio: hidden ? ["pipe", "pipe", "pipe"] : "ignore",
        shell: false
      });
    } catch (error) {
      this.lastFailure = `FXServer could not start: ${String(error)}`;
      this.#closeLog();
      this.#emit();
      return this.lastFailure;
    }
    this.#child = child;
    this.status = "starting";
    this.startedAt = this.#deps.now();
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.#ingest(chunk));
    child.stderr?.on("data", (chunk: string) => this.#ingest(chunk));
    child.stdin?.on("error", () => undefined);
    child.on("error", error => {
      this.lastFailure = `FXServer failed: ${String(error)}`;
      this.#exited(null);
    });
    child.on("exit", code => this.#exited(code));
    this.#scheduleProbe();
    this.#emit();
    return undefined;
  }

  /** Asks the server to quit, then force-closes the process tree if it hasn't exited in time. */
  stop(): void {
    const child = this.#child;
    if (!child || !this.isActive) return;
    this.#stopRequested = true;
    this.status = "stopping";
    this.#emit();
    if (!this.send("quit")) {
      this.#kill();
      return;
    }
    clearTimeout(this.#stopTimer);
    this.#stopTimer = setTimeout(() => this.#kill(), STOP_GRACE_MS);
  }

  /** Writes a console command to a hidden server. Returns false when the console isn't ours. */
  send(command: string): boolean {
    if (!this.acceptsInput) return false;
    const line = command.replace(/[\r\n]+/g, " ").trim();
    if (!line) return false;
    this.#child!.stdin!.write(`${line}\n`);
    this.#record(`> ${line}`);
    return true;
  }

  /** Total lines seen since start; pair with `linesSince` to read a command's output. */
  get lineCount(): number {
    return this.#lineTotal;
  }

  linesSince(total: number): string[] {
    const available = this.#lineTotal - total;
    if (available <= 0) return [];
    return this.lines.slice(Math.max(0, this.lines.length - available));
  }

  dispose(): void {
    clearTimeout(this.#probeTimer);
    clearTimeout(this.#stopTimer);
    this.removeAllListeners();
  }

  #kill(): void {
    const pid = this.#child?.pid;
    if (pid) this.#deps.killTree(pid);
  }

  #exited(code: number | null): void {
    if (!this.#child) return;
    clearTimeout(this.#probeTimer);
    clearTimeout(this.#stopTimer);
    if (this.#partial) this.#record(this.#partial);
    this.#partial = "";
    this.#child = undefined;
    this.exitCode = code;
    const expected = this.#stopRequested || code === 0;
    this.status = expected ? "stopped" : "crashed";
    if (!expected && !this.lastFailure) this.lastFailure = `FXServer exited with code ${code ?? "unknown"}.`;
    this.#record(`[FiveDeck] FXServer exited (${code ?? "no code"}).`);
    this.#closeLog();
    this.#emit();
    if (!expected && this.#config?.autoRestart) this.#autoRestart();
  }

  #autoRestart(): void {
    const now = this.#deps.now();
    this.#restarts = this.#restarts.filter(time => now - time < RESTART_WINDOW_MS);
    if (this.#restarts.length >= MAX_RESTARTS) {
      this.lastFailure = `FXServer crashed ${MAX_RESTARTS} times in 5 minutes; auto-restart paused.`;
      this.#emit();
      return;
    }
    this.#restarts.push(now);
    const config = this.#config!;
    setTimeout(() => {
      if (this.status === "crashed") this.start(config);
    }, 2_000).unref?.();
  }

  #scheduleProbe(): void {
    clearTimeout(this.#probeTimer);
    this.#probeTimer = setTimeout(() => void this.#probe(), PROBE_INTERVAL_MS);
    this.#probeTimer.unref?.();
  }

  async #probe(): Promise<void> {
    const config = this.#config;
    if (!config || this.status !== "starting") return;
    const url = config.configFile
      ? `http://127.0.0.1:${config.gamePort}/dynamic.json`
      : `http://127.0.0.1:${config.txAdminPort}/`;
    const up = await this.#deps.probe(url).catch(() => false);
    if (this.status !== "starting") return;
    if (up) {
      this.status = "running";
      this.#emit();
    } else {
      this.#scheduleProbe();
    }
  }

  #ingest(chunk: string): void {
    const text = this.#partial + chunk;
    const parts = text.split(/\r?\n/);
    this.#partial = parts.pop() ?? "";
    if (this.#partial.length > 4096) {
      parts.push(this.#partial);
      this.#partial = "";
    }
    let changed = false;
    for (const raw of parts) {
      const line = cleanConsoleOutput(raw).trimEnd();
      if (!line) continue;
      this.#record(line);
      if (SCRIPT_ERROR.test(line)) {
        this.scriptErrors++;
        this.lastError = line.trim();
        changed = true;
      }
      const pin = TXADMIN_PIN.exec(line);
      if (pin && !this.#config?.configFile) {
        this.txAdminPin = pin[1];
        changed = true;
      }
    }
    if (changed) this.#emit();
  }

  #record(line: string): void {
    this.lines.push(line);
    this.#lineTotal++;
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    this.#log?.write(`${line}\n`);
    this.emit("line", line);
  }

  #openLog(path: string | undefined): void {
    this.#closeLog();
    if (!path) return;
    try {
      if (existsSync(path) && statSync(path).size > LOG_ROLL_BYTES) renameSync(path, `${path}.old`);
      this.#log = createWriteStream(path, { flags: "a" });
      this.#log.on("error", () => this.#closeLog());
      this.#log.write(`\n[FiveDeck] ${new Date().toISOString()} starting FXServer\n`);
    } catch {
      this.#log = undefined;
    }
  }

  #closeLog(): void {
    this.#log?.end();
    this.#log = undefined;
  }

  #emit(): void {
    this.emit("change", this);
  }
}

/** Keeps one supervised server per profile name. */
export class FxServerManager extends EventEmitter {
  readonly #instances = new Map<string, FxServerInstance>();
  readonly #deps: FxServerDependencies;

  constructor(deps: FxServerDependencies) {
    super();
    this.#deps = deps;
  }

  get(profile: string): FxServerInstance {
    const key = normalizeProfile(profile);
    let instance = this.#instances.get(key);
    if (!instance) {
      instance = new FxServerInstance(this.#deps);
      instance.on("change", () => this.emit("change", key, instance));
      this.#instances.set(key, instance);
    }
    return instance;
  }

  find(profile: string): FxServerInstance | undefined {
    return this.#instances.get(normalizeProfile(profile));
  }

  /**
   * Asks hidden servers to quit when the plugin shuts down. Servers in their own console window
   * belong to the user at that point and keep running.
   */
  stopAll(): void {
    for (const instance of this.#instances.values()) if (instance.acceptsInput) instance.stop();
  }
}

export function normalizeProfile(profile: unknown): string {
  const value = typeof profile === "string" ? profile.trim().toLowerCase() : "";
  return value || "local";
}

/** Default dependencies for the real plugin. */
export function systemDependencies(): FxServerDependencies {
  return {
    spawn: (command, args, options) => spawn(command, args, options),
    probe: async url => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
        await response.body?.cancel();
        return true;
      } catch {
        return false;
      }
    },
    exists: path => existsSync(path),
    killTree: pid => {
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
      } else {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
    },
    now: () => Date.now()
  };
}
