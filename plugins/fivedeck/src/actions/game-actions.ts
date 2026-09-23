import { SingletonAction, type DidReceiveSettingsEvent, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { DispatchError, releaseLines } from "../core/game.ts";
import { labelKeyImage, toggleKeyImage } from "../core/key-art.ts";
import { findKey, type Modifier } from "../core/keys.ts";
import { bool, oneOf, str, type Transport } from "../core/settings.ts";
import { commandLines } from "../core/text.ts";
import { alert, PressTracker, setImage, UUID, type FiveDeck, type Settings } from "./common.ts";

export const TRANSPORTS: readonly Transport[] = ["bridge", "console", "chat"];

export function transportOf(settings: Settings): Transport {
  return oneOf(settings.transport, TRANSPORTS, "bridge");
}

/** Logs why a press did nothing and flashes the key's alert. */
export function reportFailure(fd: FiveDeck, action: any, what: string, error: unknown): void {
  const message = error instanceof DispatchError ? error.message : String(error);
  fd.log(`${what}: ${message}`);
  alert(action);
}

/** Shared bookkeeping for keys that keep settings and their own image. */
abstract class TrackedAction extends SingletonAction<Settings> {
  protected readonly fd: FiveDeck;
  protected readonly settings = new Map<string, Settings>();
  protected readonly images = new Map<string, string>();

  constructor(fd: FiveDeck) {
    super();
    this.fd = fd;
  }

  override onWillAppear(ev: WillAppearEvent<Settings>): void | Promise<void> {
    this.settings.set(ev.action.id, ev.payload.settings);
    this.render(ev.action);
    if (this.usesBridge(ev.payload.settings)) this.fd.game.ensureBridgeSoon();
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void | Promise<void> {
    this.settings.delete(ev.action.id);
    this.images.delete(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void | Promise<void> {
    this.settings.set(ev.action.id, ev.payload.settings);
    this.render(ev.action);
    if (this.usesBridge(ev.payload.settings)) this.fd.game.ensureBridgeSoon();
  }

  protected current(ev: { action: { id: string }; payload: { settings: Settings } }): Settings {
    return this.settings.get(ev.action.id) ?? ev.payload.settings;
  }

  protected usesBridge(settings: Settings): boolean {
    return transportOf(settings) === "bridge";
  }

  protected render(_action: any): void {}
}

/**
 * Game Command: one or more console commands. Press runs them; Hold runs `+commands` on press and
 * the matching `-commands` on release (push-to-talk); Toggle alternates between two command sets.
 */
export class CommandAction extends TrackedAction {
  override readonly manifestId = UUID.command;

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const settings = this.current(ev);
    const mode = oneOf(settings.mode, ["press", "hold", "toggle"] as const, "press");
    const transport = transportOf(settings);
    let lines = commandLines(settings.commands);
    if (mode === "toggle") {
      const on = !bool(settings.on);
      lines = on ? lines : commandLines(settings.commandsOff);
      if (lines.length === 0) lines = commandLines(settings.commands);
      try {
        await this.fd.game.run(lines, transport);
        const next = { ...settings, on };
        this.settings.set(ev.action.id, next);
        await ev.action.setSettings(next);
        if (ev.action.isKey()) await ev.action.setState(on ? 1 : 0);
      } catch (error) {
        reportFailure(this.fd, ev.action, "Game Command", error);
      }
      return;
    }
    try {
      await this.fd.game.run(lines, transport);
    } catch (error) {
      reportFailure(this.fd, ev.action, "Game Command", error);
    }
  }

  override async onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> {
    const settings = this.current(ev);
    if (oneOf(settings.mode, ["press", "hold", "toggle"] as const, "press") !== "hold") return;
    const release = releaseLines(commandLines(settings.commands));
    if (release.length === 0) return;
    try {
      await this.fd.game.run(release, transportOf(settings));
    } catch (error) {
      reportFailure(this.fd, ev.action, "Game Command release", error);
    }
  }

  protected override render(action: any): void {
    const settings = this.settings.get(action.id) ?? {};
    if (action.isKey?.() && oneOf(settings.mode, ["press", "hold", "toggle"] as const, "press") === "toggle") {
      action.setState(bool(settings.on) ? 1 : 0).catch(() => undefined);
    }
  }
}

/** Emote: tap plays the emote, holding cancels whatever emote is playing. */
export class EmoteAction extends TrackedAction {
  override readonly manifestId = UUID.emote;
  readonly #press = new PressTracker(600);

  override onKeyDown(ev: KeyDownEvent<Settings>): void {
    const settings = this.current(ev);
    // Without hold-to-cancel there's nothing to wait for, so play on press.
    if (!bool(settings.holdCancel, true)) {
      this.#play(ev.action, settings);
      return;
    }
    this.#press.down(ev.action.id, () => {
      const cancel = commandLines(str(settings.cancelCommand) || "e c");
      this.fd.game.run(cancel, transportOf(settings)).catch(error => reportFailure(this.fd, ev.action, "Emote cancel", error));
    });
  }

  override onKeyUp(ev: KeyUpEvent<Settings>): void {
    const settings = this.current(ev);
    this.#press.up(ev.action.id, () => this.#play(ev.action, settings));
  }

  #play(action: any, settings: Settings): void {
    const emote = str(settings.emote);
    if (!emote) {
      reportFailure(this.fd, action, "Emote", "Choose an emote name in the key settings.");
      return;
    }
    const prefix = str(settings.prefix) || "e";
    this.fd.game.run([`${prefix} ${emote}`], transportOf(settings)).catch(error => reportFailure(this.fd, action, "Emote", error));
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.#press.cancel(ev.action.id);
    super.onWillDisappear(ev);
  }

  protected override render(action: any): void {
    const settings = this.settings.get(action.id) ?? {};
    const emote = str(settings.emote);
    setImage(action, emote && bool(settings.caption, true) ? labelKeyImage({ glyph: "emote", label: emote }) : undefined, this.images);
  }
}

/** Chat Message: types a message into chat and sends it, or leaves the chat box open to finish. */
export class ChatAction extends TrackedAction {
  override readonly manifestId = UUID.chat;

  protected override usesBridge(): boolean {
    return false;
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const settings = this.current(ev);
    const lines = commandLines(settings.message);
    const send = bool(settings.send, true);
    try {
      if (lines.length === 0) throw new DispatchError("empty", "Write a message in the key settings.");
      // Only the last line may be left unsent for editing.
      for (const [index, line] of lines.entries()) await this.fd.game.chat(line, send || index < lines.length - 1);
    } catch (error) {
      reportFailure(this.fd, ev.action, "Chat Message", error);
    }
  }
}

export function keyModifiers(settings: Settings): Modifier[] {
  const raw: unknown = settings.modifiers;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const result: Modifier[] = [];
  for (const value of values) {
    const modifier = oneOf(String(value).trim(), ["ctrl", "shift", "alt"] as const, "ctrl");
    if (String(value).trim() === modifier && !result.includes(modifier)) result.push(modifier);
  }
  return result;
}

export function keyCaption(settings: Settings): string {
  const key = findKey(settings.key);
  if (!key) return "SET KEY";
  return [...keyModifiers(settings).map(modifier => modifier.toUpperCase()), key.name].join("+");
}

/**
 * Game Key: presses a key in the game — ideally F13-F24, which no keyboard has, so they can be
 * assigned in FiveM's own Key Bindings menu to any RegisterKeyMapping control (radio, menus, voice).
 */
export class GameKeyAction extends TrackedAction {
  override readonly manifestId = UUID.key;

  protected override usesBridge(): boolean {
    return false;
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const settings = this.current(ev);
    const key = findKey(settings.key);
    if (!key) {
      reportFailure(this.fd, ev.action, "Game Key", "Choose a key in the key settings.");
      return;
    }
    const hold = oneOf(settings.mode, ["tap", "hold"] as const, "hold") === "hold";
    try {
      await this.fd.game.key(key, keyModifiers(settings), hold ? "down" : "tap");
    } catch (error) {
      reportFailure(this.fd, ev.action, "Game Key", error);
    }
  }

  override async onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> {
    const settings = this.current(ev);
    const key = findKey(settings.key);
    if (!key || oneOf(settings.mode, ["tap", "hold"] as const, "hold") !== "hold") return;
    await this.fd.game.key(key, keyModifiers(settings), "up").catch(error => reportFailure(this.fd, ev.action, "Game Key release", error));
  }

  protected override render(action: any): void {
    const settings = this.settings.get(action.id) ?? {};
    setImage(action, bool(settings.caption, true) ? labelKeyImage({ glyph: "key", label: keyCaption(settings), mono: true }) : undefined, this.images);
  }
}

export interface DevTool {
  label: string;
  on: string;
  off: string;
}

/** Client developer overlays. All are archived convars, so the game remembers them between sessions. */
export const DEV_TOOLS: Record<string, DevTool> = {
  resmon: { label: "Resmon", on: "resmon 1", off: "resmon 0" },
  netgraph: { label: "Netgraph", on: "netgraph 1", off: "netgraph 0" },
  fps: { label: "FPS", on: "cl_drawFPS 1", off: "cl_drawFPS 0" },
  perf: { label: "Perf", on: "cl_drawPerf 1", off: "cl_drawPerf 0" },
  strdbg: { label: "Streaming", on: "strdbg 1", off: "strdbg 0" },
  neteventlog: { label: "Net events", on: "netEventLog 1", off: "netEventLog 0" }
};

export function devTool(settings: Settings): DevTool {
  const id = str(settings.tool) || "resmon";
  if (id === "custom") {
    return { label: str(settings.customLabel) || "Custom", on: str(settings.customOn), off: str(settings.customOff) };
  }
  return DEV_TOOLS[id] ?? DEV_TOOLS.resmon;
}

/**
 * Dev Toggle: flips a developer overlay on and off. These convars are blocked in F8 on production
 * clients, so the toggle always goes through the bridge, which runs with full console rights.
 */
export class ToggleAction extends TrackedAction {
  override readonly manifestId = UUID.toggle;

  protected override usesBridge(): boolean {
    return true;
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const settings = this.current(ev);
    const tool = devTool(settings);
    const on = !bool(settings.on);
    const command = on ? tool.on : tool.off;
    try {
      await this.fd.game.run(commandLines(command), "bridge");
      const next = { ...settings, on };
      this.settings.set(ev.action.id, next);
      await ev.action.setSettings(next);
      this.render(ev.action);
    } catch (error) {
      reportFailure(this.fd, ev.action, "Dev Toggle", error);
    }
  }

  protected override render(action: any): void {
    const settings = this.settings.get(action.id) ?? {};
    setImage(action, toggleKeyImage({ label: devTool(settings).label, on: bool(settings.on) }), this.images);
  }
}
