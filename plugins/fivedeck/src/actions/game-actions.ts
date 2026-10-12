import { SingletonAction, type DidReceiveSettingsEvent, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { DevConError } from "../core/devcon.ts";
import { DispatchError, releaseLines } from "../core/game.ts";
import { labelKeyImage, toggleKeyImage } from "../core/key-art.ts";
import { findKey, type Modifier } from "../core/keys.ts";
import { bool, oneOf, str, type Transport } from "../core/settings.ts";
import { commandLines } from "../core/text.ts";
import { alert, PressTracker, setImage, UUID, type FiveDeck, type Settings } from "./common.ts";

export const TRANSPORTS: readonly Transport[] = ["direct"];

export function transportOf(_settings: Settings): Transport {
  // Migrate all command actions on read. Explicit Chat Message remains a separate action.
  return "direct";
}

export function commandTarget(fd: FiveDeck): { instance: string; generation: number } {
  return { instance: fd.game.connection.instance, generation: fd.game.connection.generation };
}
export function targetUnchanged(fd: FiveDeck, target: ReturnType<typeof commandTarget>): boolean {
  return target.instance === fd.game.connection.instance && target.generation === fd.game.connection.generation;
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
  readonly #pending = new Map<string, { tail: Promise<void>; count: number }>();

  protected serial(action: any, task: () => Promise<void>, cleanup = false): Promise<void> {
    const entry = this.#pending.get(action.id) ?? { tail: Promise.resolve(), count: 0 };
    if (!cleanup && entry.count >= 8) return Promise.reject(new Error("Too many pending presses. Wait briefly and press again."));
    entry.count++;
    const queuedAt = Date.now();
    const generation = this.fd.game.connection.generation;
    const instance = this.fd.game.connection.instance;
    const next = entry.tail.then(async () => {
      if (!cleanup && (generation !== this.fd.game.connection.generation || instance !== this.fd.game.connection.instance)) throw new Error("Client connection changed. This queued press was cancelled; press again.");
      if (!cleanup && Date.now() - queuedAt > 2500) throw new Error("This press expired. Check the connection and press again.");
      await task();
    }).finally(() => { if (--entry.count === 0) this.#pending.delete(action.id); });
    entry.tail = next.catch(() => undefined);
    this.#pending.set(action.id, entry);
    return next;
  }

  constructor(fd: FiveDeck) {
    super();
    this.fd = fd;
  }

  override onWillAppear(ev: WillAppearEvent<Settings>): void | Promise<void> {
    this.settings.set(ev.action.id, ev.payload.settings);
    this.render(ev.action);
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void | Promise<void> {
    this.settings.delete(ev.action.id);
    this.images.delete(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void | Promise<void> {
    this.settings.set(ev.action.id, ev.payload.settings);
    this.render(ev.action);
  }

  protected current(ev: { action: { id: string }; payload: { settings: Settings } }): Settings {
    return this.settings.get(ev.action.id) ?? ev.payload.settings;
  }


  protected render(_action: any): void {}
}

/**
 * Game Command: one or more console commands. Press runs them; Hold runs `+commands` on press and
 * the matching `-commands` on release (push-to-talk); Toggle alternates between two command sets.
 */
const feedbackTimers = new Map<string, NodeJS.Timeout>();
export async function sendCommand(fd: FiveDeck, action: any, lines: string[]): Promise<void> {
  clearTimeout(feedbackTimers.get(action.id));
  if (action.isKey?.()) void action.setTitle?.("SENDING").catch(() => undefined);
  else void action.setFeedback?.({ detail: "Connecting…" }).catch(() => undefined);
  try {
    await fd.game.run(lines);
    if (action.isKey?.()) void action.setTitle?.("SENT").catch(() => undefined);
    else void action.setFeedback?.({ detail: "Transmitted · check game" }).catch(() => undefined);
  } catch (error) {
    if (action.isKey?.()) void action.setTitle?.(error instanceof DevConError && error.uncertain ? "CHECK GAME" : "CHECK LINK").catch(() => undefined);
    else void action.setFeedback?.({ detail: "Not confirmed · check setup" }).catch(() => undefined);
    throw error;
  } finally {
    if (action.isKey?.()) {
      const timer = setTimeout(() => { feedbackTimers.delete(action.id); void action.setTitle?.().catch(() => undefined); }, 1800);
      timer.unref?.();
      feedbackTimers.set(action.id, timer);
    }
  }
}

export class CommandAction extends TrackedAction {
  override readonly manifestId = UUID.command;
  readonly #releases = new Map<string, Promise<void>>();
  readonly #pressSequence = new Map<string, number>();
  readonly #holds = new Map<string, { release: string[]; instance: string; generation: number; pids: string }>();

  override onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    this.#pressSequence.set(ev.action.id, (this.#pressSequence.get(ev.action.id) ?? 0) + 1);
    return this.serial(ev.action, async () => {
      if (!this.settings.has(ev.action.id)) return;
      const settings = this.current(ev);
      const mode = oneOf(settings.mode, ["press", "hold", "toggle"] as const, "press");
      if (mode === "hold" && this.#holds.has(ev.action.id)) return;
      const on = !bool(settings.on);
      let lines = commandLines(mode === "toggle" && !on ? settings.commandsOff : settings.commands);
      if (!lines.length && mode === "toggle") lines = commandLines(settings.commands);
      if (mode === "hold") {
        const release = releaseLines(lines);
        if (release.length) {
          const instance = this.fd.game.connection.instance;
          const generation = this.fd.game.connection.generation;
          const status = await this.fd.game.status(true);
          if (instance !== this.fd.game.connection.instance || generation !== this.fd.game.connection.generation) throw new Error("Client selection changed. This hold was cancelled; press again.");
          if (!status.pids.length) throw new Error("Hold mode needs a detectable FiveM process so releases stay with the same game session.");
          this.#holds.set(ev.action.id, { release, instance,
            generation, pids: [...status.pids].sort().join(",") });
        }
      }
      try { await sendCommand(this.fd, ev.action, lines); }
      catch (error) {
        if (!(error instanceof DevConError && error.uncertain)) this.#holds.delete(ev.action.id);
        throw error;
      }
      if (mode === "toggle") {
        // This is the last requested toggle direction, not a read-back of game state.
        const next = { ...(this.settings.get(ev.action.id) ?? settings), on };
        if (this.settings.has(ev.action.id)) this.settings.set(ev.action.id, next);
        await ev.action.setSettings(next);
        if (ev.action.isKey()) await ev.action.setState(on ? 1 : 0);
      }
    }).catch(error => reportFailure(this.fd, ev.action, "Game Command", error));
  }
  async #release(action: any): Promise<void> {
    const held = this.#holds.get(action.id);
    this.#holds.delete(action.id);
    if (!held) return;
    const status = await this.fd.game.status(true);
    if (held.instance !== this.fd.game.connection.instance || held.generation !== this.fd.game.connection.generation
      || held.pids !== [...status.pids].sort().join(",")) {
      throw new Error("The connection or game session changed while holding. Release the control in-game; FiveDeck did not replay into another session.");
    }
    await sendCommand(this.fd, action, held.release);
  }
  #scheduleRelease(action: any): Promise<void> {
    const token = `${action.id}:${this.#pressSequence.get(action.id) ?? 0}`;
    const pending = this.#releases.get(token);
    if (pending) return pending;
    const release = this.serial(action, () => this.#release(action), true)
      .catch(error => reportFailure(this.fd, action, "Game Command release", error))
      .finally(() => { this.#releases.delete(token); });
    this.#releases.set(token, release);
    return release;
  }
  override onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> { return this.#scheduleRelease(ev.action); }
  override onWillDisappear(ev: WillDisappearEvent<Settings>): Promise<void> {
    super.onWillDisappear(ev);
    return this.#scheduleRelease(ev.action);
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
  readonly #targets = new Map<string, ReturnType<typeof commandTarget>>();

  override onKeyDown(ev: KeyDownEvent<Settings>): void {
    const settings = this.current(ev);
    const target = commandTarget(this.fd);
    this.#targets.set(ev.action.id, target);
    // Without hold-to-cancel there's nothing to wait for, so play on press.
    if (!bool(settings.holdCancel, true)) {
      this.#play(ev.action, settings, target);
      return;
    }
    this.#press.down(ev.action.id, () => {
      if (!targetUnchanged(this.fd, target)) { reportFailure(this.fd, ev.action, "Emote", "Client connection changed during the press. Press again."); return; }
      const cancel = commandLines(str(settings.cancelCommand) || "e c");
      sendCommand(this.fd, ev.action, cancel).catch(error => reportFailure(this.fd, ev.action, "Emote cancel", error));
    });
  }

  override onKeyUp(ev: KeyUpEvent<Settings>): void {
    const settings = this.current(ev);
    const target = this.#targets.get(ev.action.id);
    this.#targets.delete(ev.action.id);
    this.#press.up(ev.action.id, () => { if (target) this.#play(ev.action, settings, target); });
  }

  #play(action: any, settings: Settings, target: ReturnType<typeof commandTarget>): void {
    if (!targetUnchanged(this.fd, target)) { reportFailure(this.fd, action, "Emote", "Client connection changed during the press. Press again."); return; }
    const emote = str(settings.emote);
    if (!emote) {
      reportFailure(this.fd, action, "Emote", "Choose an emote name in the key settings.");
      return;
    }
    const prefix = str(settings.prefix) || "e";
    sendCommand(this.fd, action, [`${prefix} ${emote}`]).catch(error => reportFailure(this.fd, action, "Emote", error));
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.#press.cancel(ev.action.id);
    this.#targets.delete(ev.action.id);
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
  readonly #held = new Map<string, { key: NonNullable<ReturnType<typeof findKey>>; modifiers: Modifier[] }>();


  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const settings = this.current(ev);
    const key = findKey(settings.key);
    if (!key) {
      reportFailure(this.fd, ev.action, "Game Key", "Choose a key in the key settings.");
      return;
    }
    const hold = oneOf(settings.mode, ["tap", "hold"] as const, "hold") === "hold";
    try {
      const modifiers = keyModifiers(settings);
      if (hold) this.#held.set(ev.action.id, { key, modifiers });
      await this.fd.game.key(key, modifiers, hold ? "down" : "tap");
    } catch (error) {
      this.#held.delete(ev.action.id);
      reportFailure(this.fd, ev.action, "Game Key", error);
    }
  }

  async #release(action: any): Promise<void> {
    const held = this.#held.get(action.id);
    this.#held.delete(action.id);
    if (held) await this.fd.game.key(held.key, held.modifiers, "up").catch(error => reportFailure(this.fd, action, "Game Key release", error));
  }
  override onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> { return this.#release(ev.action); }
  override onWillDisappear(ev: WillDisappearEvent<Settings>): Promise<void> {
    super.onWillDisappear(ev);
    return this.#release(ev.action);
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
 * clients. Direct dispatch remains subject to the current client and command permissions.
 */
export class ToggleAction extends TrackedAction {
  override readonly manifestId = UUID.toggle;


  override onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    return this.serial(ev.action, async () => {
      if (!this.settings.has(ev.action.id)) return;
      const settings = this.current(ev);
      const tool = devTool(settings);
      const on = !bool(settings.on);
      await sendCommand(this.fd, ev.action, commandLines(on ? tool.on : tool.off));
      const next = { ...(this.settings.get(ev.action.id) ?? settings), on };
      if (this.settings.has(ev.action.id)) this.settings.set(ev.action.id, next);
      await ev.action.setSettings(next);
      this.render(ev.action);
    }).catch(error => reportFailure(this.fd, ev.action, "Dev Toggle", error));
  }

  protected override render(action: any): void {
    const settings = this.settings.get(action.id) ?? {};
    setImage(action, toggleKeyImage({ label: devTool(settings).label, on: bool(settings.on) }), this.images);
  }
}
