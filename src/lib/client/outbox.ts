import {
  buildAudioPacket,
  buildSosPacket,
  fromHex,
  toBase64,
  type SigningIdentity,
  type SosPayload,
} from "../packet";

/**
 * Offline outbox: an SOS that cannot be sent is kept on the phone and retried when the connection returns.
 * We store the *request* (not the sealed packet) and rebuild the packet at send time with a fresh timestamp and
 * the SAME message id: the server's replay window would reject an hour-old packet, while the stable id keeps
 * deduplication working if an earlier attempt actually got through.
 */

export const AUDIO_CHUNK = 60_000;
export const MAX_ATTEMPTS = 8;

export interface OutboxItem {
  /** Message id (hex, 16 bytes). Stable across retries. */
  id: string;
  createdAt: number;
  sos: SosPayload;
  urgency: number;
  /** WAV mono PCM16 16 kHz, optional. */
  audio?: Uint8Array;
  attempts: number;
}

export interface WirePacket {
  packet: string;
  path: string[];
}

/** Pure: builds the SOS packet and its audio fragments for `nowMs`. */
export function buildPackets(item: OutboxItem, identity: SigningIdentity, centerPublicKey: Uint8Array, nowMs: number, path: string[] = ["tel-sim", "gw-1"]): WirePacket[] {
  const msgId = fromHex(item.id);
  const timestamp = Math.floor(nowMs / 1000);
  const opts = { identity, centerPublicKey, timestamp };
  const out: WirePacket[] = [{ packet: toBase64(buildSosPacket(item.sos, { ...opts, msgId, urgency: item.urgency })), path }];
  if (item.audio) {
    const chunk = Math.max(AUDIO_CHUNK, Math.ceil(item.audio.length / 16));
    const total = Math.ceil(item.audio.length / chunk);
    for (let i = 0; i < total; i++) {
      const data = item.audio.slice(i * chunk, (i + 1) * chunk);
      // Audio fragments get their own random id; they are tied to the SOS through parentId.
      out.push({ packet: toBase64(buildAudioPacket({ parentId: msgId, index: i, total, data }, opts)), path });
    }
  }
  return out;
}

export interface OutboxStore {
  put(item: OutboxItem): Promise<void>;
  list(): Promise<OutboxItem[]>;
  remove(id: string): Promise<void>;
}

export function memoryStore(): OutboxStore {
  const items = new Map<string, OutboxItem>();
  return {
    async put(i) { items.set(i.id, i); },
    async list() { return [...items.values()].sort((a, b) => a.createdAt - b.createdAt); },
    async remove(id) { items.delete(id); },
  };
}

/** IndexedDB-backed store (audio can be hundreds of kB). Falls back to memory where IndexedDB is unavailable. */
export function indexedDbStore(name = "solaris-outbox"): OutboxStore {
  const fallback = memoryStore();
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("items", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await open();
    return new Promise<T>((resolve, reject) => {
      const req = fn(d.transaction("items", mode).objectStore("items"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    async put(i) { try { await run("readwrite", (s) => s.put(i)); } catch { await fallback.put(i); } },
    async list() {
      try { return ((await run("readonly", (s) => s.getAll())) as OutboxItem[]).sort((a, b) => a.createdAt - b.createdAt); }
      catch { return fallback.list(); }
    },
    async remove(id) { try { await run("readwrite", (s) => s.delete(id)); } catch { await fallback.remove(id); } },
  };
}

export type PostOutcome =
  | { kind: "network_error" }
  | { kind: "result"; status: "accepted" | "duplicate" | "rejected"; reason?: string };

export interface FlushDeps {
  store: OutboxStore;
  identity: SigningIdentity;
  centerPublicKey: Uint8Array;
  post: (packets: WirePacket[]) => Promise<PostOutcome>;
  now?: () => number;
}

/** Whether a server answer means the SOS is already at the command center (so the item can leave the outbox). */
export function isDelivered(o: PostOutcome): boolean {
  if (o.kind !== "result") return false;
  // "replay" means an earlier attempt got through and only its response was lost.
  return o.status === "accepted" || o.status === "duplicate" || (o.status === "rejected" && o.reason === "replay");
}

/** Sends queued items oldest first. Stops at the first network error. Gives up on an item after MAX_ATTEMPTS refusals. */
export async function flushOutbox(d: FlushDeps): Promise<{ delivered: number; dropped: number; remaining: number }> {
  const now = d.now ?? Date.now;
  let delivered = 0;
  let dropped = 0;
  for (const item of await d.store.list()) {
    const outcome = await d.post(buildPackets(item, d.identity, d.centerPublicKey, now()));
    if (outcome.kind === "network_error") break;
    if (isDelivered(outcome)) {
      await d.store.remove(item.id);
      delivered++;
    } else if (item.attempts + 1 >= MAX_ATTEMPTS) {
      await d.store.remove(item.id);
      dropped++;
    } else {
      await d.store.put({ ...item, attempts: item.attempts + 1 });
    }
  }
  return { delivered, dropped, remaining: (await d.store.list()).length };
}

/** Center public key is not secret: cache it so the phone can seal SOS even when the app is opened offline. */
export async function loadCenterKey(fetchKey: () => Promise<string>, storage: Pick<Storage, "getItem" | "setItem"> | null): Promise<string | null> {
  const KEY = "solaris.centerKey";
  try {
    const fresh = await fetchKey();
    try { storage?.setItem(KEY, fresh); } catch { /* storage unavailable */ }
    return fresh;
  } catch {
    try { return storage?.getItem(KEY) ?? null; } catch { return null; }
  }
}
