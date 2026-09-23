import streamDeck, { SingletonAction, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent, type DidReceiveSettingsEvent } from "@elgato/streamdeck";
import { spawn } from "node:child_process";
import { join, win32 } from "node:path";
import type { FxServerConfig, FxServerInstance } from "../core/fxserver.ts";
import { statusKeyImage, type Tone } from "../core/key-art.ts";
import type { ServerSnapshot } from "../core/server-query.ts";
import { bool, num, oneOf, serverSlot, str } from "../core/settings.ts";
import { formatUptimeCompact } from "../core/text.ts";
import { alert, ok, PressTracker, setImage, UUID, type FiveDeck, type Settings } from "./common.ts";

type PressAction = "log" | "restart" | "txadmin" | "nothing";

interface Tracked {
  action: any;
  settings: Settings;
  unwatch?: () => void;
  players?: ServerSnapshot;
}

export function fxServerConfig(settings: Settings, logFile: string): FxServerConfig {
  const executable = str(settings.executable);
  const configPath = str(settings.configPath);
  const txAdmin = oneOf(settings.mode, ["cfg", "txadmin"] as const, "cfg") === "txadmin";
  return {
    executable,
    dataDirectory: txAdmin ? (executable ? win32.dirname(executable) : "") : (configPath ? win32.dirname(configPath) : ""),
    configFile: txAdmin ? "" : (configPath ? win32.basename(configPath) : ""),
    extraArgs: str(settings.extraArgs),
    consoleMode: oneOf(settings.consoleMode, ["hidden", "window"] as const, "hidden"),
    gamePort: 30120,
    txAdminPort: num(settings.txAdminPort, 40120, 1, 65535),
    autoRestart: bool(settings.autoRestart),
    logFile
  };
}

const STATUS_TONE: Record<string, Tone> = { stopped: "idle", starting: "warn", running: "good", stopping: "warn", crashed: "bad" };

export class FxServerAction extends SingletonAction<Settings> {
  override readonly manifestId = UUID.fxserver;
  readonly #fd: FiveDeck;
  readonly #keys = new Map<string, Tracked>();
  readonly #images = new Map<string, string>();
  readonly #press = new PressTracker(800);
  readonly #ticker: NodeJS.Timeout;

  constructor(fd: FiveDeck) {
    super();
    this.#fd = fd;
    fd.servers.on("change", () => this.#renderAll());
    // Re-point player-count polling when a slot's port changes.
    fd.onGlobalChange(() => {
      for (const tracked of this.#keys.values()) {
        tracked.unwatch?.();
        tracked.unwatch = undefined;
        tracked.players = undefined;
      }
      this.#renderAll();
    });
    this.#ticker = setInterval(() => this.#renderAll(), 1_000);
    this.#ticker.unref();
  }

  override onWillAppear(ev: WillAppearEvent<Settings>): void {
    this.#keys.set(ev.action.id, { action: ev.action, settings: ev.payload.settings });
    this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.#keys.get(ev.action.id)?.unwatch?.();
    this.#keys.delete(ev.action.id);
    this.#images.delete(ev.action.id);
    this.#press.cancel(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
    const tracked = this.#keys.get(ev.action.id);
    if (tracked) tracked.settings = ev.payload.settings;
    this.#render(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<Settings>): void {
    const id = ev.action.id;
    this.#press.down(id, () => {
      const server = this.#server(id);
      if (server?.isActive) {
        server.stop();
        ok(ev.action);
      }
    });
  }

  override onKeyUp(ev: KeyUpEvent<Settings>): void {
    this.#press.up(ev.action.id, () => this.#tap(ev.action.id));
  }

  #server(id: string): FxServerInstance | undefined {
    const tracked = this.#keys.get(id);
    if (!tracked) return undefined;
    return this.#fd.servers.get(serverSlot(this.#fd.global(), tracked.settings.slot).id);
  }

  #logFile(settings: Settings): string {
    return join(this.#fd.logDirectory, `fxserver-${serverSlot(this.#fd.global(), settings.slot).id}.log`);
  }

  #tap(id: string): void {
    const tracked = this.#keys.get(id);
    const server = this.#server(id);
    if (!tracked || !server) return;
    if (!server.isActive) {
      const config = fxServerConfig(tracked.settings, this.#logFile(tracked.settings));
      config.gamePort = serverSlot(this.#fd.global(), tracked.settings.slot).port;
      const failure = server.start(config);
      if (failure) {
        this.#fd.log(`FXServer start failed: ${failure}`);
        alert(tracked.action);
      }
      return;
    }
    const press = oneOf<PressAction>(tracked.settings.pressAction, ["log", "restart", "txadmin", "nothing"], "log");
    if (press === "restart") this.#restart(server, tracked);
    else if (press === "txadmin") void streamDeck.system.openUrl(`http://localhost:${num(tracked.settings.txAdminPort, 40120, 1, 65535)}/`);
    else if (press === "log") this.#openLog(tracked);
  }

  #restart(server: FxServerInstance, tracked: Tracked): void {
    const config = server.config;
    if (!config) return;
    const restartWhenStopped = () => {
      if (server.isActive) return;
      server.off("change", restartWhenStopped);
      if (server.start(config)) alert(tracked.action);
    };
    server.on("change", restartWhenStopped);
    server.stop();
  }

  /** Opens a read-only live view of a hidden server's console in its own window. */
  #openLog(tracked: Tracked): void {
    if (process.platform !== "win32") return;
    const server = this.#server(tracked.action.id);
    if (server?.config?.consoleMode === "window") return;
    const path = this.#logFile(tracked.settings).replaceAll("'", "''");
    const script = `$Host.UI.RawUI.WindowTitle = 'FiveDeck - FXServer log'; Get-Content -LiteralPath '${path}' -Wait -Tail 200`;
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NoExit", "-Command", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.on("error", error => this.#fd.log(`Log window failed: ${String(error)}`));
    child.unref();
  }

  #renderAll(): void {
    for (const id of this.#keys.keys()) this.#render(id);
  }

  #render(id: string): void {
    const tracked = this.#keys.get(id);
    const server = this.#server(id);
    if (!tracked || !server) return;
    const slot = serverSlot(this.#fd.global(), tracked.settings.slot);

    // Watch player counts only while the server runs.
    if (server.status === "running" && !tracked.unwatch) {
      tracked.unwatch = () => undefined;
      tracked.unwatch = this.#fd.watcher.watch({ kind: "endpoint", host: "127.0.0.1", port: slot.port }, 10_000, snapshot => {
        tracked.players = snapshot;
        this.#render(id);
      });
    } else if (server.status !== "running" && tracked.unwatch) {
      tracked.unwatch();
      tracked.unwatch = undefined;
      tracked.players = undefined;
    }

    const configured = Boolean(str(tracked.settings.executable));
    const txAdmin = tracked.settings.mode === "txadmin";
    let subtitle = txAdmin ? "txAdmin" : (str(tracked.settings.configPath) ? win32.basename(str(tracked.settings.configPath)) : "server.cfg");
    if (server.txAdminPin) subtitle = `PIN ${server.txAdminPin}`;
    else if (tracked.players?.build) subtitle = `build ${tracked.players.build}`;

    let value: string | undefined;
    let label: string = server.status;
    if (!configured) {
      label = "setup";
      value = "SETUP";
      subtitle = "Pick FXServer.exe";
    } else if (server.status === "stopped") {
      value = "START";
    } else if (server.status === "crashed") {
      value = "RETRY";
    } else {
      value = formatUptimeCompact(Date.now() - server.startedAt);
    }
    const players = tracked.players;
    const meter = players?.players !== undefined && players.maxPlayers ? players.players / players.maxPlayers : undefined;
    const image = statusKeyImage({
      label,
      tone: configured ? STATUS_TONE[server.status] : "accent",
      title: slot.name === `Server ${slot.id.slice(1)}` ? "FXServer" : slot.name,
      subtitle,
      value,
      meter: server.status === "running" ? (meter ?? 0) : undefined,
      badge: server.scriptErrors
    });
    setImage(tracked.action, image, this.#images);
  }
}
