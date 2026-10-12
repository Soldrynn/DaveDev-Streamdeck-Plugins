import streamDeck, { SingletonAction, type DidReceiveSettingsEvent, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { connectString, parseServerTarget, type ServerTarget } from "../core/cfx-address.ts";
import { statusKeyImage, type StatusKeyView } from "../core/key-art.ts";
import { artifactVerdict, fetchArtifactVersions, type ArtifactVersions, type ServerSnapshot } from "../core/server-query.ts";
import { MIN_ENDPOINT_INTERVAL_MS, MIN_JOIN_INTERVAL_MS } from "../core/watcher.ts";
import { bool, num, oneOf, serverSlot } from "../core/settings.ts";
import { alert, ok, PressTracker, setImage, UUID, type FiveDeck, type Settings } from "./common.ts";
import { reportFailure, sendCommand, commandTarget, targetUnchanged } from "./game-actions.ts";

/** Builds the Join Server key from a target and its latest snapshot. Exported for tests. */
export function joinView(target: ServerTarget | undefined, snapshot: ServerSnapshot | undefined, label?: string): StatusKeyView {
  if (!target) return { label: "setup", tone: "accent", title: "Join Server", subtitle: "Add a join code", value: "SETUP" };
  const connect = connectString(target);
  const title = label || snapshot?.name || (target.kind === "join" ? target.code.toUpperCase() : connect);
  if (!snapshot) return { label: "checking", tone: "idle", title, subtitle: connect };
  if (snapshot.online === false) return { label: "offline", tone: "bad", title, subtitle: connect, value: "—" };
  if (snapshot.online === undefined) return { label: "join", tone: "accent", title, subtitle: connect, value: "JOIN" };
  const players = snapshot.players;
  const max = snapshot.maxPlayers;
  return {
    label: "online",
    tone: "good",
    title,
    subtitle: connect,
    value: players === undefined ? "JOIN" : max ? `${players}/${max}` : String(players),
    meter: players !== undefined && max ? players / max : undefined
  };
}

interface JoinKey {
  action: any;
  settings: Settings;
  target?: ServerTarget;
  unwatch?: () => void;
  snapshot?: ServerSnapshot;
}

/**
 * Join Server: live status (name, players, capacity) for a join code or address. Tap joins — from
 * a closed game, the main menu, or queued behind the current session. Hold switches now: FiveDeck
 * sends the link, then `disconnect`, and FiveM connects to the queued server as the session ends.
 */
export class JoinAction extends SingletonAction<Settings> {
  override readonly manifestId = UUID.join;
  readonly #fd: FiveDeck;
  readonly #keys = new Map<string, JoinKey>();
  readonly #images = new Map<string, string>();
  readonly #press = new PressTracker(700);
  readonly #targets = new Map<string, ReturnType<typeof commandTarget>>();

  constructor(fd: FiveDeck) {
    super();
    this.#fd = fd;
  }

  override onWillAppear(ev: WillAppearEvent<Settings>): void {
    this.#keys.set(ev.action.id, { action: ev.action, settings: ev.payload.settings });
    this.#configure(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.#keys.get(ev.action.id)?.unwatch?.();
    this.#keys.delete(ev.action.id);
    this.#images.delete(ev.action.id);
    this.#press.cancel(ev.action.id);
    this.#targets.delete(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
    const key = this.#keys.get(ev.action.id);
    if (!key) return;
    key.settings = ev.payload.settings;
    this.#configure(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<Settings>): void {
    const target = commandTarget(this.#fd);
    this.#targets.set(ev.action.id, target);
    this.#press.down(ev.action.id, () => {
      if (!targetUnchanged(this.#fd, target)) { reportFailure(this.#fd, ev.action, "Join Server", "Client connection changed during the press. Press again."); return; }
      void this.#join(ev.action.id, true);
    });
  }

  override onKeyUp(ev: KeyUpEvent<Settings>): void {
    const target = this.#targets.get(ev.action.id);
    this.#targets.delete(ev.action.id);
    this.#press.up(ev.action.id, () => {
      if (!target || !targetUnchanged(this.#fd, target)) { reportFailure(this.#fd, ev.action, "Join Server", "Client connection changed during the press. Press again."); return; }
      void this.#join(ev.action.id, false);
    });
  }

  async #join(id: string, switchNow: boolean): Promise<void> {
    const key = this.#keys.get(id);
    if (!key) return;
    if (!key.target) {
      reportFailure(this.#fd, key.action, "Join Server", "Add a join code or server address in the key settings.");
      return;
    }
    try {
      const result = await this.#fd.game.join(key.target, switchNow);
      if (result === "no-fivem") reportFailure(this.#fd, key.action, "Join Server", "FiveM.exe wasn't found. Set its location in FiveDeck's game settings.");
      else {
        await key.action.setTitle("SENT");
        const timer = setTimeout(() => void key.action.setTitle().catch(() => undefined), 1800);
        timer.unref?.();
      }
    } catch (error) {
      reportFailure(this.#fd, key.action, "Join Server", error);
    }
  }

  #configure(id: string): void {
    const key = this.#keys.get(id);
    if (!key) return;
    const target = parseServerTarget(key.settings.address);
    const changed = (target && connectString(target)) !== (key.target && connectString(key.target));
    if (changed || !bool(key.settings.showStatus, true)) {
      key.unwatch?.();
      key.unwatch = undefined;
      key.snapshot = undefined;
    }
    key.target = target;
    if (target && bool(key.settings.showStatus, true) && !key.unwatch) {
      const floor = target.kind === "join" ? MIN_JOIN_INTERVAL_MS : MIN_ENDPOINT_INTERVAL_MS;
      const interval = num(key.settings.pollSeconds, floor / 1000, floor / 1000, 3600) * 1000;
      key.unwatch = this.#fd.watcher.watch(target, interval, snapshot => {
        key.snapshot = snapshot;
        this.#render(id);
      });
    }
    this.#render(id);
  }

  #render(id: string): void {
    const key = this.#keys.get(id);
    if (!key) return;
    const label = typeof key.settings.label === "string" ? key.settings.label.trim() : "";
    const showStatus = bool(key.settings.showStatus, true);
    const view = joinView(key.target, showStatus ? key.snapshot : undefined, label);
    if (key.target && !showStatus) Object.assign(view, { label: "join", tone: "accent", value: "JOIN" });
    setImage(key.action, statusKeyImage(view), this.#images);
  }
}

/** Launch FiveM: shows whether the game runs; tap launches or focuses it, hold quits it. */
export class LaunchAction extends SingletonAction<Settings> {
  override readonly manifestId = UUID.launch;
  readonly #fd: FiveDeck;
  readonly #actions = new Map<string, any>();
  readonly #press = new PressTracker(900);
  readonly #targets = new Map<string, ReturnType<typeof commandTarget>>();
  #timer: NodeJS.Timeout | undefined;
  #running: boolean | undefined;

  constructor(fd: FiveDeck) {
    super();
    this.#fd = fd;
  }

  override onWillAppear(ev: WillAppearEvent<Settings>): void {
    this.#actions.set(ev.action.id, ev.action);
    this.#running = undefined;
    void this.#poll();
    this.#timer ??= setInterval(() => void this.#poll(), 3_000);
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.#actions.delete(ev.action.id);
    this.#press.cancel(ev.action.id);
    this.#targets.delete(ev.action.id);
    if (this.#actions.size === 0) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  override onKeyDown(ev: KeyDownEvent<Settings>): void {
    const target = commandTarget(this.#fd);
    this.#targets.set(ev.action.id, target);
    this.#press.down(ev.action.id, () => {
      if (!targetUnchanged(this.#fd, target)) { reportFailure(this.#fd, ev.action, "Quit FiveM", "Client connection changed during the press. Press again."); return; }
      sendCommand(this.#fd, ev.action, ["quit"]).catch(error => reportFailure(this.#fd, ev.action, "Quit FiveM", error));
    });
  }

  override onKeyUp(ev: KeyUpEvent<Settings>): void {
    const target = this.#targets.get(ev.action.id);
    this.#targets.delete(ev.action.id);
    this.#press.up(ev.action.id, async () => {
      if (!target || !targetUnchanged(this.#fd, target)) { reportFailure(this.#fd, ev.action, "Launch FiveM", "Client connection changed during the press. Press again."); return; }
      const status = await this.#fd.game.status();
      if (status.running) {
        if (!(await this.#fd.game.focus())) alert(ev.action);
        return;
      }
      if (await this.#fd.game.launch()) ok(ev.action);
      else reportFailure(this.#fd, ev.action, "Launch FiveM", "FiveM.exe wasn't found. Set its location in FiveDeck's game settings.");
    });
  }

  async #poll(): Promise<void> {
    const running = (await this.#fd.game.status()).running;
    if (running === this.#running) return;
    this.#running = running;
    for (const action of this.#actions.values()) {
      if (action.isKey?.()) action.setState(running ? 1 : 0).catch(() => undefined);
    }
  }
}

interface ArtifactKey {
  action: any;
  settings: Settings;
  unwatch?: () => void;
  build?: number;
}

/**
 * Artifact Watch: compares the FXServer build a server runs with the recommended, latest, and
 * critical builds from the same feed txAdmin uses. Tap opens the recommended download, hold the
 * latest one.
 */
export class ArtifactAction extends SingletonAction<Settings> {
  override readonly manifestId = UUID.artifacts;
  readonly #fd: FiveDeck;
  readonly #keys = new Map<string, ArtifactKey>();
  readonly #images = new Map<string, string>();
  readonly #press = new PressTracker(700);
  readonly #feeds = new Map<string, { versions?: ArtifactVersions; fetchedAt: number; error?: string }>();
  #timer: NodeJS.Timeout | undefined;

  constructor(fd: FiveDeck) {
    super();
    this.#fd = fd;
    // A slot's host or port may have changed; re-point the build comparison.
    fd.onGlobalChange(() => {
      for (const id of this.#keys.keys()) this.#configure(id);
    });
  }

  override onWillAppear(ev: WillAppearEvent<Settings>): void {
    this.#keys.set(ev.action.id, { action: ev.action, settings: ev.payload.settings });
    this.#configure(ev.action.id);
    this.#timer ??= setInterval(() => void this.#refreshFeeds(false), 30 * 60_000);
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.#keys.get(ev.action.id)?.unwatch?.();
    this.#keys.delete(ev.action.id);
    this.#images.delete(ev.action.id);
    if (this.#keys.size === 0) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
    const key = this.#keys.get(ev.action.id);
    if (!key) return;
    key.settings = ev.payload.settings;
    this.#configure(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<Settings>): void {
    this.#press.down(ev.action.id, () => this.#open(ev.action.id, "latest"));
  }

  override onKeyUp(ev: KeyUpEvent<Settings>): void {
    this.#press.up(ev.action.id, () => this.#open(ev.action.id, "recommended"));
  }

  #platform(settings: Settings): "win32" | "linux" {
    return oneOf(settings.platform, ["win32", "linux"] as const, "win32");
  }

  #open(id: string, which: "recommended" | "latest"): void {
    const key = this.#keys.get(id);
    if (!key) return;
    const versions = this.#feeds.get(this.#platform(key.settings))?.versions;
    if (!versions) {
      void this.#refreshFeeds(true);
      alert(key.action);
      return;
    }
    void streamDeck.system.openUrl(which === "latest" ? versions.latestDownload : versions.recommendedDownload);
  }

  #configure(id: string): void {
    const key = this.#keys.get(id);
    if (!key) return;
    key.unwatch?.();
    key.unwatch = undefined;
    key.build = undefined;
    if (bool(key.settings.compare, true)) {
      const slot = serverSlot(this.#fd.global(), key.settings.slot);
      key.unwatch = this.#fd.watcher.watch({ kind: "endpoint", host: slot.host, port: slot.port }, 60_000, snapshot => {
        key.build = snapshot?.build;
        this.#render(id);
      });
    }
    void this.#refreshFeeds(false);
    this.#render(id);
  }

  async #refreshFeeds(force: boolean): Promise<void> {
    const platforms = new Set([...this.#keys.values()].map(key => this.#platform(key.settings)));
    for (const platform of platforms) {
      const feed = this.#feeds.get(platform);
      if (!force && feed && Date.now() - feed.fetchedAt < 25 * 60_000) continue;
      this.#feeds.set(platform, { ...feed, fetchedAt: Date.now() });
      try {
        this.#feeds.set(platform, { versions: await fetchArtifactVersions(platform), fetchedAt: Date.now() });
      } catch (error) {
        this.#feeds.set(platform, { versions: feed?.versions, fetchedAt: Date.now(), error: String(error) });
        this.#fd.log(`Artifact feed (${platform}) failed: ${String(error)}`);
      }
    }
    for (const id of this.#keys.keys()) this.#render(id);
  }

  #render(id: string): void {
    const key = this.#keys.get(id);
    if (!key) return;
    const feed = this.#feeds.get(this.#platform(key.settings));
    const versions = feed?.versions;
    let view: StatusKeyView;
    if (!versions) {
      view = { label: feed?.error ? "offline" : "checking", tone: feed?.error ? "bad" : "idle", title: "Artifacts", subtitle: this.#platform(key.settings) === "win32" ? "Windows" : "Linux" };
    } else {
      const verdict = artifactVerdict(key.build, versions);
      const tone = verdict === "critical" ? "bad" : verdict === "outdated" ? "warn" : verdict === "unknown" ? "accent" : "good";
      view = {
        label: verdict === "unknown" ? "recommended" : verdict,
        tone,
        title: "Artifacts",
        subtitle: key.build ? `rec ${versions.recommended}` : `latest ${versions.latest}`,
        value: String(key.build ?? versions.recommended)
      };
    }
    setImage(key.action, statusKeyImage(view), this.#images);
  }
}
