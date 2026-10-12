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
import { handleConnectionRequest } from "./core/connection-ui.ts";
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
process.on("exit", () => { fd.game.dispose(); servers.stopAll(); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { fd.game.dispose(); servers.stopAll(); process.exit(0); });

streamDeck.settings.onDidReceiveGlobalSettings(ev => {
  const previous = fd.input().clientInstance;
  globalSettings = (ev.settings ?? {}) as GlobalSettings;
  if (previous !== fd.input().clientInstance) fd.game.connection.reset();
  globalChanged();
});

// Only status and an identity handshake are exposed to the property inspector.
const sendConnectionStatus = () => streamDeck.ui.sendToPropertyInspector({ event: "connection-status", ...fd.game.connection.status }).catch(() => undefined);
fd.game.connection.subscribe(() => { void sendConnectionStatus(); });
streamDeck.ui.onSendToPlugin<{ event?: string; clientInstance?: string }>(async ev => {
  await handleConnectionRequest(ev.payload, fd.game.connection, status =>
    streamDeck.ui.sendToPropertyInspector({ event: "connection-status", ...status }).catch(() => undefined));
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
const initialInstance = fd.input().clientInstance;
globalSettings = ((await streamDeck.settings.getGlobalSettings()) ?? {}) as GlobalSettings;
if (initialInstance !== fd.input().clientInstance) fd.game.connection.reset();
globalChanged();
log(`FiveDeck ${streamDeck.info.plugin.version} ready (${Object.keys(UUID).length} actions).`);
