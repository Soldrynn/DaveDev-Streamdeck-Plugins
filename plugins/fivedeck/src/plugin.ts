import streamDeck from "@elgato/streamdeck";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { UUID, type FiveDeck } from "./actions/common.ts";
import { DialAction } from "./actions/dial.ts";
import { FxServerAction } from "./actions/fxserver.ts";
import { ChatAction, CommandAction, EmoteAction, GameKeyAction, ToggleAction } from "./actions/game-actions.ts";
import { ArtifactAction, JoinAction, LaunchAction } from "./actions/server-actions.ts";
import { ServerCommandAction } from "./actions/server-command.ts";
import { FxServerManager, systemDependencies } from "./core/fxserver.ts";
import { GameController } from "./core/game.ts";
import { inputSettings, type GlobalSettings } from "./core/settings.ts";
import { ServerWatcher } from "./core/watcher.ts";
import { loadNativeInput } from "./core/win32.ts";

let globalSettings: GlobalSettings = {};
const logDirectory = join(process.cwd(), "logs");
try {
  mkdirSync(logDirectory, { recursive: true });
} catch {
  // Stream Deck creates logs/ itself; FXServer logging degrades gracefully without it.
}

const log = (message: string) => streamDeck.logger.info(message);
const globalListeners = new Set<() => void>();
const servers = new FxServerManager(systemDependencies());
const fd: FiveDeck = {
  global: () => globalSettings,
  input: () => inputSettings(globalSettings),
  servers,
  watcher: new ServerWatcher(),
  game: new GameController({
    native: () => loadNativeInput(log),
    settings: () => inputSettings(globalSettings),
    log
  }),
  logDirectory,
  log,
  onGlobalChange(listener) {
    globalListeners.add(listener);
  }
};
const globalChanged = () => {
  for (const listener of globalListeners) listener();
};

// A dropped Stream Deck socket or a vanished key must never take the plugin down.
process.on("unhandledRejection", reason => streamDeck.logger.warn(`Unhandled rejection: ${String(reason)}`));
process.on("uncaughtException", error => streamDeck.logger.error(`Uncaught exception: ${error.stack ?? String(error)}`));
// Hidden servers also quit on their own when stdin closes; this makes the shutdown explicit.
process.on("exit", () => servers.stopAll());

streamDeck.settings.onDidReceiveGlobalSettings(ev => {
  globalSettings = (ev.settings ?? {}) as GlobalSettings;
  globalChanged();
});

// Property inspector requests that need the plugin's view of the machine.
streamDeck.ui.onSendToPlugin<{ event?: string }>(async ev => {
  const request = ev.payload?.event;
  if (request !== "bridge-status" && request !== "bridge-install") return;
  const settings = inputSettings(globalSettings);
  const result = request === "bridge-install" ? await fd.game.installBridgeOffline() : undefined;
  const [state, status, fivem] = await Promise.all([fd.game.bridgeState(), fd.game.status(), fd.game.fivemExecutable()]);
  await streamDeck.ui.sendToPropertyInspector({
    event: "bridge-status",
    key: settings.bridgeKey,
    state,
    result: result ?? null,
    gameRunning: status.running,
    fivem: fivem ?? null,
    platform: process.platform
  });
});

for (const action of [
  new CommandAction(fd),
  new EmoteAction(fd),
  new ChatAction(fd),
  new GameKeyAction(fd),
  new ToggleAction(fd),
  new JoinAction(fd),
  new LaunchAction(fd),
  new FxServerAction(fd),
  new ServerCommandAction(fd),
  new ArtifactAction(fd),
  new DialAction(fd)
]) {
  streamDeck.actions.registerAction(action);
}

await streamDeck.connect();
globalSettings = ((await streamDeck.settings.getGlobalSettings()) ?? {}) as GlobalSettings;
globalChanged();
log(`FiveDeck ${streamDeck.info.plugin.version} ready (${Object.keys(UUID).length} actions).`);
