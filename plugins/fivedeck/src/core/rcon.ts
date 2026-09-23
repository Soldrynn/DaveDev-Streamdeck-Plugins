/**
 * Minimal FXServer RCON client. FXServer answers Quake-style out-of-band UDP packets on its game
 * port: the request is `\xFF\xFF\xFF\xFFrcon <password> <command>` and the reply is one or more
 * `\xFF\xFF\xFF\xFFprint <text>` datagram per UDP endpoint (servers with several endpoints can
 * repeat it). RCON is unencrypted and rate-limited to one request per five seconds for addresses
 * outside `sv_proxyIPRanges`, so FiveDeck recommends it for servers on the same machine or LAN.
 */
import { createSocket, type Socket } from "node:dgram";
import { lookup } from "node:dns/promises";

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export interface RconRequest {
  host: string;
  port: number;
  password: string;
  command: string;
  /** Total time allowed for the first reply. */
  timeoutMs?: number;
  /** How long to keep listening for continuation packets after a reply arrives. */
  settleMs?: number;
}

export type RconErrorCode = "timeout" | "password" | "invalid" | "network";

export class RconError extends Error {
  readonly code: RconErrorCode;
  constructor(message: string, code: RconErrorCode) {
    super(message);
    this.name = "RconError";
    this.code = code;
  }
}

export function validateRconPassword(password: string): string | undefined {
  if (!password) return "Set an RCON password first.";
  if (/[\s"]/.test(password)) return "RCON passwords can't contain spaces or quotes.";
  return undefined;
}

export function encodeRconPacket(password: string, command: string): Buffer {
  return Buffer.concat([HEADER, Buffer.from(`rcon ${password} ${command}`, "utf8")]);
}

/** Returns the printable text of a reply packet, or undefined for packets that aren't replies. */
export function decodeRconPacket(packet: Buffer): string | undefined {
  if (packet.length < 4 || !packet.subarray(0, 4).equals(HEADER)) return undefined;
  const body = packet.subarray(4).toString("utf8");
  const match = /^print\s?([\s\S]*)$/.exec(body);
  return match ? match[1] : undefined;
}

/** Strips ANSI escapes and Cfx `^n` colour codes from console output. */
export function cleanConsoleOutput(text: string): string {
  return text.replace(ANSI, "").replace(/\^[0-9]/g, "").replace(/\r/g, "");
}

export async function sendRcon(request: RconRequest): Promise<string> {
  const invalid = validateRconPassword(request.password);
  if (invalid) throw new RconError(invalid, "invalid");
  const command = request.command.replace(/[\r\n]+/g, " ").trim();
  if (!command) throw new RconError("The command is empty.", "invalid");

  let address: { address: string; family: number };
  try {
    address = await lookup(request.host);
  } catch (error) {
    throw new RconError(`Can't resolve ${request.host}: ${String(error)}`, "network");
  }

  const socket: Socket = createSocket(address.family === 6 ? "udp6" : "udp4");
  const timeoutMs = request.timeoutMs ?? 2_500;
  const settleMs = request.settleMs ?? 200;

  return new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];
    let settleTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      clearTimeout(settleTimer);
      socket.close();
      if (error) reject(error);
      else resolve(cleanConsoleOutput(chunks.join("")).trim());
    };
    const timeout = setTimeout(() => {
      if (chunks.length > 0) finish();
      else finish(new RconError(`No RCON reply from ${request.host}:${request.port}. Check rcon_password and the port.`, "timeout"));
    }, timeoutMs);

    socket.on("error", error => finish(new RconError(String(error), "network")));
    socket.on("message", (packet, remote) => {
      if (remote.port !== request.port) return;
      const text = decodeRconPacket(packet);
      if (text === undefined) return;
      if (/^\s*Invalid password\.?\s*$/i.test(text)) {
        finish(new RconError("The server rejected the RCON password.", "password"));
        return;
      }
      if (/must set rcon_password/i.test(text)) {
        finish(new RconError("The server has no rcon_password set, so RCON is off.", "password"));
        return;
      }
      // Servers with several UDP endpoints send the same reply once per endpoint.
      if (!chunks.includes(text)) chunks.push(text);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => finish(), settleMs);
    });
    socket.send(encodeRconPacket(request.password, command), request.port, address.address, error => {
      if (error) finish(new RconError(String(error), "network"));
    });
  });
}
