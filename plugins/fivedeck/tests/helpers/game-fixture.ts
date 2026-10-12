import { DevConClient } from "../../src/core/devcon.ts";
import { GameController } from "../../src/core/game.ts";
import type { KeyStroke } from "../../src/core/keys.ts";
import { inputSettings } from "../../src/core/settings.ts";
import type { NativeInput } from "../../src/core/win32.ts";
export class FakeNative implements NativeInput {
  log: string[] = [];
  foreground = "FiveM_b3258_GTAProcess.exe";
  pids = [77];
  accept = true;
  send(strokes: readonly KeyStroke[]) { this.log.push(strokes.map(s => `${s.up ? "-" : "+"}${s.key.name}`).join(" ")); return this.accept; }
  typeText(text: string) { this.log.push(`type:${text}`); return this.accept; }
  foregroundProcess() { return { pid: 77, name: this.foreground }; }
  processes() { return this.pids.map(pid => ({ pid, name: "FiveM_b3258_GTAProcess.exe" })); }
  focusProcessWindow() { this.foreground = "FiveM_b3258_GTAProcess.exe"; return true; }
}
export class RecordingConnection extends DevConClient {
  lines: string[][] = [];
  failure?: Error;
  gate?: () => Promise<void>;
  override async send(lines: readonly string[]): Promise<void> {
    this.lines.push([...lines]);
    await this.gate?.();
    if (this.failure) throw this.failure;
  }
}
export function controller(options: { overrides?: Record<string, unknown>; native?: FakeNative; sleep?: (ms: number) => Promise<void> } = {}) {
  const overrides = options.overrides ?? {};
  const native = options.native ?? new FakeNative();
  const connection = new RecordingConnection({ instance: () => inputSettings(overrides).clientInstance });
  const game = new GameController({ native: async () => native, settings: () => inputSettings(overrides), connection,
    log: () => undefined, sleep: options.sleep ?? (async () => undefined), processCacheMs: 0 });
  return { game, native, connection, overrides };
}
