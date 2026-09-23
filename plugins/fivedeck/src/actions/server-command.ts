import { SingletonAction, type DidReceiveSettingsEvent, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { labelKeyImage } from "../core/key-art.ts";
import { sendRcon } from "../core/rcon.ts";
import { bool, oneOf, serverSlot, str } from "../core/settings.ts";
import { commandLines } from "../core/text.ts";
import { alert, ok, setImage, UUID, type FiveDeck, type Settings } from "./common.ts";

export type ServerPreset = "ensure" | "restart" | "stop" | "refresh-ensure" | "refresh" | "custom";
const PRESETS: readonly ServerPreset[] = ["ensure", "restart", "stop", "refresh-ensure", "refresh", "custom"];
const RESOURCE_NAME = /^[A-Za-z0-9_\-.[\]]{1,64}$/;

/** Builds the console commands for a key; `undefined` means the settings are incomplete. */
export function serverCommands(settings: Settings): string[] | undefined {
  const preset = oneOf(settings.preset, PRESETS, "ensure");
  if (preset === "custom") {
    const lines = commandLines(settings.custom).map(line => line.replace(/^\/+/, ""));
    return lines.length ? lines : undefined;
  }
  if (preset === "refresh") return ["refresh"];
  const resource = str(settings.resource);
  if (!RESOURCE_NAME.test(resource)) return undefined;
  if (preset === "refresh-ensure") return ["refresh", `ensure ${resource}`];
  return [`${preset} ${resource}`];
}

/** Reads FXServer's reply for the resource commands' known failure messages. */
export function outputFailed(output: string): boolean {
  return /Couldn't (?:find|start|stop) resource|SCRIPT ERROR|Unknown command|No such command/i.test(output);
}

export function serverCommandCaption(settings: Settings): string {
  const preset = oneOf(settings.preset, PRESETS, "ensure");
  if (preset === "custom") return commandLines(settings.custom)[0] ?? "command";
  if (preset === "refresh") return "refresh";
  return str(settings.resource) || preset;
}

export class ServerCommandAction extends SingletonAction<Settings> {
  override readonly manifestId = UUID.serverCommand;
  readonly #fd: FiveDeck;
  readonly #settings = new Map<string, Settings>();
  readonly #images = new Map<string, string>();
  readonly #busy = new Set<string>();

  constructor(fd: FiveDeck) {
    super();
    this.#fd = fd;
  }

  override onWillAppear(ev: WillAppearEvent<Settings>): void {
    this.#settings.set(ev.action.id, ev.payload.settings);
    this.#render(ev.action);
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.#settings.delete(ev.action.id);
    this.#images.delete(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
    this.#settings.set(ev.action.id, ev.payload.settings);
    this.#render(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const id = ev.action.id;
    if (this.#busy.has(id)) return;
    const settings = this.#settings.get(id) ?? ev.payload.settings;
    const commands = serverCommands(settings);
    if (!commands) {
      this.#fd.log("Server Command: the key has no valid resource or command yet.");
      alert(ev.action);
      return;
    }
    this.#busy.add(id);
    try {
      const output = await this.#run(settings, commands);
      if (outputFailed(output)) {
        this.#fd.log(`Server Command reported a failure:\n${output}`);
        alert(ev.action);
      } else {
        ok(ev.action);
      }
    } catch (error) {
      this.#fd.log(`Server Command failed: ${String(error)}`);
      alert(ev.action);
    } finally {
      this.#busy.delete(id);
    }
  }

  /** Prefers the console of a server FiveDeck started; otherwise uses RCON. */
  async #run(settings: Settings, commands: string[]): Promise<string> {
    const slot = serverSlot(this.#fd.global(), settings.slot);
    const managed = this.#fd.servers.find(slot.id);
    if (managed?.acceptsInput) {
      const before = managed.lineCount;
      for (const command of commands) managed.send(command);
      await new Promise(resolve => setTimeout(resolve, 900));
      return managed.linesSince(before).join("\n");
    }
    const outputs: string[] = [];
    for (const command of commands) {
      outputs.push(await sendRcon({ host: slot.host, port: slot.port, password: slot.password, command }));
    }
    return outputs.join("\n");
  }

  #render(action: any): void {
    const settings = this.#settings.get(action.id) ?? {};
    if (!bool(settings.caption, true)) {
      setImage(action, undefined, undefined);
      this.#images.delete(action.id);
      return;
    }
    setImage(action, labelKeyImage({ glyph: "server-command", label: serverCommandCaption(settings), mono: true }), this.#images);
  }
}
