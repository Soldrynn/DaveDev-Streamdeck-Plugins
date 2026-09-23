import { SingletonAction, type DialDownEvent, type DialRotateEvent, type DidReceiveSettingsEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { bool, num, oneOf, str } from "../core/settings.ts";
import { commandLines, fillTemplate, truncateText } from "../core/text.ts";
import { UUID, type FiveDeck, type Settings } from "./common.ts";
import { reportFailure, transportOf } from "./game-actions.ts";

export interface DialItem {
  label: string;
  command: string;
}

/** `Label = command` or just `command`, one per line. */
export function dialItems(value: unknown): DialItem[] {
  return commandLines(value).map(line => {
    const split = line.indexOf(" = ");
    if (split > 0) return { label: line.slice(0, split).trim(), command: line.slice(split + 3).trim() };
    return { label: line, command: line };
  }).filter(item => item.command);
}

export interface DialState {
  mode: "list" | "range";
  items: DialItem[];
  index: number;
  value: number;
  min: number;
  max: number;
  step: number;
  wrap: boolean;
  template: string;
}

export function dialState(settings: Settings): DialState {
  const min = num(settings.min, 1, -1_000_000, 1_000_000);
  const max = Math.max(min, num(settings.max, 10, -1_000_000, 1_000_000));
  const items = dialItems(settings.items);
  return {
    mode: oneOf(settings.mode, ["list", "range"] as const, "list"),
    items,
    index: Math.floor(num(settings.index, 0, 0, Math.max(0, items.length - 1))),
    value: num(settings.value, min, min, max),
    min,
    max,
    step: num(settings.step, 1, 0.001, 1_000_000),
    wrap: bool(settings.wrap, true),
    template: str(settings.template)
  };
}

/** Applies dial ticks, wrapping or clamping. Returns the new index or value. */
export function rotate(state: DialState, ticks: number): { index: number; value: number } {
  if (state.mode === "list") {
    const count = state.items.length;
    if (count === 0) return { index: 0, value: state.value };
    let index = state.index + ticks;
    index = state.wrap ? ((index % count) + count) % count : Math.min(count - 1, Math.max(0, index));
    return { index, value: state.value };
  }
  const span = state.max - state.min;
  let value = state.value + ticks * state.step;
  if (state.wrap && span > 0) {
    if (value > state.max) value = state.min + (value - state.max - state.step);
    if (value < state.min) value = state.max - (state.min - value - state.step);
  }
  value = Math.min(state.max, Math.max(state.min, Math.round(value * 1000) / 1000));
  return { index: state.index, value };
}

export function currentCommand(state: DialState): string[] {
  if (state.mode === "list") {
    const item = state.items[state.index];
    return item ? commandLines(item.command) : [];
  }
  return state.template ? commandLines(fillTemplate(state.template, state.value)) : [];
}

/**
 * Command Dial (Stream Deck +): rotate through a list of commands (an emote wheel) or a number
 * (a radio channel), then press the dial or tap the touch strip to run it.
 */
export class DialAction extends SingletonAction<Settings> {
  override readonly manifestId = UUID.dial;
  readonly #fd: FiveDeck;
  readonly #settings = new Map<string, Settings>();
  readonly #save = new Map<string, NodeJS.Timeout>();

  constructor(fd: FiveDeck) {
    super();
    this.#fd = fd;
  }

  override onWillAppear(ev: WillAppearEvent<Settings>): void {
    this.#settings.set(ev.action.id, ev.payload.settings);
    this.#render(ev.action);
    if (transportOf(ev.payload.settings) === "bridge") this.#fd.game.ensureBridgeSoon();
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.#settings.delete(ev.action.id);
    clearTimeout(this.#save.get(ev.action.id));
    this.#save.delete(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
    this.#settings.set(ev.action.id, ev.payload.settings);
    this.#render(ev.action);
  }

  override onDialRotate(ev: DialRotateEvent<Settings>): void {
    const settings = this.#settings.get(ev.action.id) ?? ev.payload.settings;
    const next = { ...settings, ...rotate(dialState(settings), ev.payload.ticks) };
    this.#settings.set(ev.action.id, next);
    this.#render(ev.action);
    // Persist the position shortly after the dial stops turning.
    clearTimeout(this.#save.get(ev.action.id));
    this.#save.set(ev.action.id, setTimeout(() => void ev.action.setSettings(next).catch(() => undefined), 600));
  }

  override onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
    return this.#run(ev.action);
  }

  override onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
    return this.#run(ev.action);
  }

  async #run(action: any): Promise<void> {
    const settings = this.#settings.get(action.id) ?? {};
    const lines = currentCommand(dialState(settings));
    try {
      await this.#fd.game.run(lines, transportOf(settings));
    } catch (error) {
      reportFailure(this.#fd, action, "Command Dial", error);
    }
  }

  #render(action: any): void {
    const settings = this.#settings.get(action.id) ?? {};
    const state = dialState(settings);
    const title = str(settings.label) || (state.mode === "list" ? "Commands" : "Value");
    let value: string;
    let detail: string;
    let progress: number;
    if (state.mode === "list") {
      const item = state.items[state.index];
      value = item ? truncateText(item.label, 16) : "Add commands";
      detail = item ? `${state.index + 1} / ${state.items.length}  ·  press to run` : "Open the dial settings";
      progress = state.items.length > 1 ? state.index / (state.items.length - 1) : 0;
    } else {
      value = String(state.value);
      detail = state.template ? truncateText(fillTemplate(state.template, state.value), 22) : "Set a command template";
      progress = state.max > state.min ? (state.value - state.min) / (state.max - state.min) : 0;
    }
    action.setFeedback?.({ title: truncateText(title.toUpperCase(), 18), value, detail, position: Math.round(progress * 100) }).catch(() => undefined);
  }
}
