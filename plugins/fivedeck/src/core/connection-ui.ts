import type { ConnectionStatus, DevConClient } from "./devcon.ts";

export interface ConnectionRequest { event?: unknown; clientInstance?: unknown; }
/** Inspector messages can read status or request an identity probe, never send commands. */
export async function handleConnectionRequest(
  request: ConnectionRequest | undefined,
  connection: DevConClient,
  reply: (status: ConnectionStatus) => Promise<void>
): Promise<void> {
  if (request?.event === "connection-status") { await reply(connection.status); return; }
  if (request?.event !== "connection-test") return;
  const wanted = request.clientInstance;
  if ((wanted !== "primary" && wanted !== "secondary") || wanted !== connection.instance) {
    await reply({ phase: "idle", message: "Saving client selection; wait and test again. No connection was opened.", at: Date.now(),
      clientInstance: wanted === "secondary" ? "secondary" : "primary" });
    return;
  }
  try { await connection.test(); } catch { /* Transport status contains the actionable failure. */ }
  await reply(connection.status);
}
