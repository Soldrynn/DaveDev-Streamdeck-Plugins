/** FiveM's local VConsole2 protocol. No key injection, remote hosts, or command retries.
 * Legacy's receiver does not reassemble CMND frames: use one command frame per fresh
 * connection, after PPCR/ AINF validation. TCP write completion is NOT execution proof.
 * https://github.com/citizenfx/fivem/blob/master/code/components/devcon/src/DevConServer.cpp
 */
import { createConnection, type Socket, type NetConnectOpts } from "node:net";

export type ClientInstance = "primary" | "secondary";
export type ConnectionPhase = "idle" | "connecting" | "ready" | "transmitted" | "disconnected";
export interface ConnectionStatus {
  phase: ConnectionPhase;
  message: string;
  at: number;
  clientInstance: ClientInstance;
}
export const MAX_COMMAND_BYTES = 1024;
export const MAX_FRAME_BYTES = 65_536;
const MAX_HANDSHAKE_BYTES = 1_048_576;
const MAX_PENDING = 8;
const PROTOCOL = 211;

export class DevConError extends Error {
  readonly uncertain: boolean;
  constructor(message: string, uncertain = false) {
    super(message);
    this.uncertain = uncertain;
    this.name = "DevConError";
  }
}

export function commandPacket(lines: readonly string[]): Buffer {
  if (!lines.length || lines.some(line => !line.trim())) throw new DevConError("Add a command before pressing this key.");
  if (lines.some(line => /[\x00-\x1f\x7f]/.test(line))) throw new DevConError("Commands cannot contain control characters.");
  const payload = Buffer.from(lines.join("\n") + "\n", "utf8");
  if (payload.length > MAX_COMMAND_BYTES) throw new DevConError(`Keep each command sequence within ${MAX_COMMAND_BYTES} UTF-8 bytes.`);
  const packet = Buffer.alloc(13 + payload.length);
  packet.write("CMND", 0, "ascii");
  packet.writeUInt16BE(PROTOCOL, 4);
  packet.writeUInt32BE(packet.length, 6);
  payload.copy(packet, 12);
  return packet;
}

/** Bounded streaming decoder for replies, including fragmented and coalesced frames. */
export class DevConFrames {
  #buffer = Buffer.alloc(0);
  #received = 0;
  push(chunk: Buffer): Buffer[] {
    this.#received += chunk.length;
    if (this.#received > MAX_HANDSHAKE_BYTES) throw new DevConError("FiveM's connection reply was too large.");
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const frames: Buffer[] = [];
    while (this.#buffer.length >= 10) {
      const length = this.#buffer.readUInt32BE(6);
      if (this.#buffer.readUInt16BE(4) !== PROTOCOL || length < 10 || length > MAX_FRAME_BYTES) {
        throw new DevConError("The local console returned an unsupported protocol reply.");
      }
      if (this.#buffer.length < length) break;
      frames.push(this.#buffer.subarray(0, length));
      this.#buffer = this.#buffer.subarray(length);
    }
    if (this.#buffer.length > MAX_FRAME_BYTES) throw new DevConError("The local console reply exceeded the size limit.");
    return frames;
  }
}

export function isCitizenInfo(frame: Buffer): boolean {
  if (frame.length < 98 || frame.toString("latin1", 0, 4) !== "AINF") return false;
  const field = (offset: number) => frame.subarray(offset, offset + 32).toString("latin1").split("\0")[0];
  const commandLineLength = frame.readUInt32BE(93);
  return field(24) === "CitizenFX" && field(56) === "CitizenFX" && commandLineLength >= 1
    && commandLineLength === frame.length - 97 && frame[frame.length - 1] === 0;
}

interface Dependencies {
  instance: () => ClientInstance;
  connect?: (options: NetConnectOpts) => Socket;
  timeoutMs?: number;
  queueMaxAgeMs?: number;
}

export class DevConClient {
  readonly #deps: Dependencies;
  readonly #listeners = new Set<(status: ConnectionStatus) => void>();
  #queue: Promise<unknown> = Promise.resolve();
  #pending = 0;
  #generation = 0;
  #disposed = false;
  #cancel?: () => void;
  #status: ConnectionStatus;

  constructor(deps: Dependencies) {
    this.#deps = deps;
    this.#status = this.#makeStatus("idle", "Press a command key or test the local connection.");
  }
  get status(): ConnectionStatus { return { ...this.#status }; }
  get generation(): number { return this.#generation; }
  get instance(): ClientInstance { return this.#deps.instance(); }
  subscribe(listener: (status: ConnectionStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #makeStatus(phase: ConnectionPhase, message: string): ConnectionStatus {
    return { phase, message, at: Date.now(), clientInstance: this.instance };
  }
  #setStatus(phase: ConnectionPhase, message: string): void {
    this.#status = this.#makeStatus(phase, message);
    for (const listener of this.#listeners) { try { listener(this.status); } catch { /* UI cannot break transport. */ } }
  }
  /** Call only when the selected client changes. Old pending commands must not switch targets. */
  reset(): void {
    this.#generation++;
    this.#cancel?.();
    this.#setStatus("idle", "Client selection changed. Press again or test the connection.");
  }
  dispose(): void {
    this.#disposed = true;
    this.#generation++;
    this.#cancel?.();
    this.#listeners.clear();
  }
  send(lines: readonly string[]): Promise<void> {
    try { return this.#enqueue(commandPacket(lines)); }
    catch (error) { return Promise.reject(error); }
  }
  test(): Promise<void> { return this.#enqueue(); }

  #enqueue(packet?: Buffer): Promise<void> {
    if (this.#disposed) return Promise.reject(new DevConError("FiveDeck is closing; no command was sent."));
    if (this.#pending >= MAX_PENDING) return Promise.reject(new DevConError("Too many pending presses. Wait briefly and press again."));
    const instance = this.instance;
    const generation = this.#generation;
    const queuedAt = Date.now();
    this.#pending++;
    const next = this.#queue.then(async () => {
      if (this.#disposed || generation !== this.#generation || instance !== this.instance) {
        throw new DevConError("This queued press was cancelled. Check the connection and press again.");
      }
      if (Date.now() - queuedAt > (this.#deps.queueMaxAgeMs ?? 2500)) throw new DevConError("This press expired while waiting. Press again when the connection is ready.");
      try { await this.#perform(instance, packet); }
      catch (error) {
        if (generation === this.#generation) {
          this.#generation++; // Cancel pending presses after a connection failure. Never replay later.
          this.#setStatus("disconnected", error instanceof Error ? error.message : "The local connection failed.");
        }
        throw error;
      }
    }).finally(() => { this.#pending--; });
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #perform(instance: ClientInstance, packet?: Buffer): Promise<void> {
    const generation = this.#generation;
    this.#setStatus("connecting", "Connecting to FiveM on this PC…");
    if (this.#disposed || generation !== this.#generation) return Promise.reject(new DevConError("Connection cancelled before sending."));
    return new Promise((resolve, reject) => {
      let socket: Socket;
      let finished = false;
      let writeAttempted = false;
      let identified = false;
      const decoder = new DevConFrames();
      const finish = (error?: Error): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.#cancel = undefined;
        if (socket) {
          socket.removeAllListeners();
          socket.on("error", () => undefined);
          if (error) socket.destroy();
          else {
            const closeDeadline = setTimeout(() => socket.destroy(), 500);
            closeDeadline.unref();
            socket.once("close", () => clearTimeout(closeDeadline));
            socket.end();
            socket.unref();
          }
        }
        if (error) reject(error); else resolve();
      };
      const fail = (detail: string): void => finish(new DevConError(writeAttempted
        ? "Connection interrupted after transmission began. The command may have run; check in-game before pressing again."
        : detail, writeAttempted));
      const timer = setTimeout(() => fail("FiveM did not respond. Start FiveM and check Remote Console setup, then press again."), this.#deps.timeoutMs ?? 1500);
      this.#cancel = () => fail("Connection cancelled. Press again after checking the selected client.");
      try {
        socket = (this.#deps.connect ?? createConnection)({ host: "127.0.0.1", port: instance === "secondary" ? 29300 : 29200, family: 4 });
        socket.setNoDelay(true);
        socket.on("error", () => fail("Cannot connect to FiveM. Start the selected client and check Remote Console setup, then press again."));
        socket.on("end", () => fail("FiveM closed the connection before the command could be transmitted."));
        socket.on("close", () => fail("FiveM disconnected before the command could be transmitted."));
        socket.on("connect", () => socket.write(Buffer.from("PPCR", "ascii"), error => { if (error) fail("Could not test the local FiveM connection."); }));
        socket.on("data", (chunk: Buffer) => {
          if (finished || identified) return;
          try {
            for (const frame of decoder.push(chunk)) {
              if (frame.toString("latin1", 0, 4) !== "AINF") continue;
              if (!isCitizenInfo(frame)) throw new DevConError("The local service did not identify itself as a supported CitizenFX console.");
              identified = true;
              if (!packet) {
                finish();
                this.#setStatus("ready", "FiveM responded. Ready for the next press; connection is checked on each press.");
              } else {
                writeAttempted = true;
                socket.write(packet, error => {
                  if (finished) return;
                  if (error) { fail("Transmission failed."); return; }
                  finish();
                  this.#setStatus("transmitted", "Command transmitted to FiveM. In-game execution is not confirmed.");
                });
              }
              break;
            }
          } catch (error) { finish(error instanceof Error ? error : new DevConError("Unsupported local console reply.")); }
        });
      } catch { fail("Could not open the local FiveM connection."); }
    });
  }
}
