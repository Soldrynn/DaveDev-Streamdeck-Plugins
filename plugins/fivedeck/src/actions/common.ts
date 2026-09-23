import streamDeck from "@elgato/streamdeck";
import type { FxServerManager } from "../core/fxserver.ts";
import type { GameController } from "../core/game.ts";
import type { GlobalSettings, InputSettings } from "../core/settings.ts";
import type { ServerWatcher } from "../core/watcher.ts";

/** Services every action shares, created once in plugin.ts. */
export interface FiveDeck {
  global(): GlobalSettings;
  input(): InputSettings;
  servers: FxServerManager;
  watcher: ServerWatcher;
  game: GameController;
  logDirectory: string;
  log(message: string): void;
  /** Runs after global settings load or change (server slots, game input). */
  onGlobalChange(listener: () => void): void;
}

export const UUID = {
  command: "com.davedev.fivedeck.command",
  emote: "com.davedev.fivedeck.emote",
  chat: "com.davedev.fivedeck.chat",
  key: "com.davedev.fivedeck.key",
  toggle: "com.davedev.fivedeck.toggle",
  join: "com.davedev.fivedeck.join",
  launch: "com.davedev.fivedeck.launch",
  fxserver: "com.davedev.fivedeck.fxserver",
  serverCommand: "com.davedev.fivedeck.servercommand",
  artifacts: "com.davedev.fivedeck.artifacts",
  dial: "com.davedev.fivedeck.dial"
} as const;

export type Settings = Record<string, any>;

/** Sets a key image, ignoring the rejection Stream Deck produces when a key vanished mid-update. */
export function setImage(action: any, image: string | undefined, cache?: Map<string, string>): void {
  if (cache && image !== undefined) {
    if (cache.get(action.id) === image) return;
    cache.set(action.id, image);
  }
  action.setImage(image).catch((error: unknown) => streamDeck.logger.debug(`setImage failed: ${String(error)}`));
}

export function alert(action: any): void {
  action.showAlert?.().catch(() => undefined);
}

export function ok(action: any): void {
  action.showOk?.().catch(() => undefined);
}

/**
 * Distinguishes a tap from a hold. The hold fires while the key is still down (so "hold to stop"
 * reacts at the threshold, not on release); a release before the threshold is a tap.
 */
export class PressTracker {
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #held = new Set<string>();
  readonly #holdMs: number;

  constructor(holdMs = 700) {
    this.#holdMs = holdMs;
  }

  down(id: string, onHold: () => void): void {
    this.cancel(id);
    this.#held.delete(id);
    this.#timers.set(id, setTimeout(() => {
      this.#timers.delete(id);
      this.#held.add(id);
      onHold();
    }, this.#holdMs));
  }

  /** Runs `onTap` if the key was released before the hold threshold. */
  up(id: string, onTap: () => void): void {
    const timer = this.#timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.#timers.delete(id);
      onTap();
    }
    this.#held.delete(id);
  }

  cancel(id: string): void {
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
  }
}
