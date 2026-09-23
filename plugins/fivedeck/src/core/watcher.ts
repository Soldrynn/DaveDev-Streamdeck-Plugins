/**
 * Shares server polling between keys. Ten keys watching the same server cause one request per
 * interval, join codes are polled gently (the Cfx list is a shared public service), and a key
 * that disappears stops its polling.
 */
import { connectString, type ServerTarget } from "./cfx-address.ts";
import { queryServer, type FetchLike, type ServerSnapshot } from "./server-query.ts";

export type SnapshotListener = (snapshot: ServerSnapshot | undefined) => void;

interface Watch {
  target: ServerTarget;
  listeners: Map<number, { listener: SnapshotListener; intervalMs: number }>;
  timer?: NodeJS.Timeout;
  inFlight: boolean;
  latest?: ServerSnapshot;
}

export const MIN_ENDPOINT_INTERVAL_MS = 5_000;
export const MIN_JOIN_INTERVAL_MS = 60_000;

export class ServerWatcher {
  readonly #watches = new Map<string, Watch>();
  readonly #fetch: FetchLike;
  #nextId = 1;

  constructor(fetchImpl: FetchLike = fetch) {
    this.#fetch = fetchImpl;
  }

  /** Starts (or joins) polling; returns an unsubscribe function. */
  watch(target: ServerTarget, intervalMs: number, listener: SnapshotListener): () => void {
    const key = connectString(target);
    let watch = this.#watches.get(key);
    if (!watch) {
      watch = { target, listeners: new Map(), inFlight: false };
      this.#watches.set(key, watch);
    }
    const id = this.#nextId++;
    watch.listeners.set(id, { listener, intervalMs });
    const latest = watch.latest;
    // Deliver the cached snapshot asynchronously so callers never re-enter their own render.
    if (latest) queueMicrotask(() => {
      if (this.#watches.get(key)?.listeners.has(id)) listener(latest);
    });
    if (!watch.timer && !watch.inFlight) void this.#poll(key);
    return () => {
      const current = this.#watches.get(key);
      if (!current) return;
      current.listeners.delete(id);
      if (current.listeners.size === 0) {
        clearTimeout(current.timer);
        this.#watches.delete(key);
      }
    };
  }

  /** Polls now instead of waiting for the next interval. */
  refresh(target: ServerTarget): void {
    const key = connectString(target);
    const watch = this.#watches.get(key);
    if (!watch || watch.inFlight) return;
    clearTimeout(watch.timer);
    watch.timer = undefined;
    void this.#poll(key);
  }

  latest(target: ServerTarget): ServerSnapshot | undefined {
    return this.#watches.get(connectString(target))?.latest;
  }

  dispose(): void {
    for (const watch of this.#watches.values()) clearTimeout(watch.timer);
    this.#watches.clear();
  }

  async #poll(key: string): Promise<void> {
    const watch = this.#watches.get(key);
    if (!watch) return;
    watch.inFlight = true;
    let snapshot: ServerSnapshot | undefined;
    try {
      snapshot = await queryServer(watch.target, this.#fetch);
    } catch {
      snapshot = undefined;
    }
    watch.inFlight = false;
    if (this.#watches.get(key) !== watch) return;
    watch.latest = snapshot;
    for (const { listener } of watch.listeners.values()) listener(snapshot);
    const floor = watch.target.kind === "join" ? MIN_JOIN_INTERVAL_MS : MIN_ENDPOINT_INTERVAL_MS;
    const requested = Math.min(...[...watch.listeners.values()].map(entry => entry.intervalMs));
    watch.timer = setTimeout(() => {
      watch.timer = undefined;
      void this.#poll(key);
    }, Math.max(floor, requested));
    watch.timer.unref?.();
  }
}
