import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, buildPackets, flushOutbox, loadCenterKey, memoryStore, type OutboxItem, type PostOutcome, type WirePacket } from "../src/lib/client/outbox";
import { getRepository } from "../src/lib/repo";
import { resetRuntime } from "../src/lib/server/runtime";
import { getCenterKeys } from "../src/lib/server/center";
import { getState, processPacket, setOffline } from "../src/lib/server/service";
import { generateIdentity, initCrypto, randomBytes, toHex } from "../src/lib/packet";

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: toHex(randomBytes(16)),
  createdAt: Date.now(),
  sos: { type: "trapped", who: ["baby"], count: 2, lat: 3.45, lon: -76.53 },
  urgency: 1,
  attempts: 0,
  ...over,
});

describe("offline outbox", () => {
  beforeAll(initCrypto);
  beforeEach(async () => {
    await getRepository().reset();
    resetRuntime();
    setOffline(false);
  });

  async function deps(post: (p: WirePacket[]) => Promise<PostOutcome>) {
    const center = await getCenterKeys();
    return { store: memoryStore(), identity: await generateIdentity(), centerPublicKey: center.publicKey, post };
  }

  it("rebuilds with a fresh timestamp: an SOS queued an hour ago is still accepted", async () => {
    const d = await deps(async () => ({ kind: "network_error" }));
    const old = item({ createdAt: Date.now() - 3_600_000 });
    const packets = buildPackets(old, d.identity, d.centerPublicKey, Date.now());
    const res = await processPacket(packets[0].packet, packets[0].path);
    expect(res).toMatchObject({ status: "accepted", kind: "sos", id: old.id });
  });

  it("keeps the message id stable across retries so a duplicate is merged, not doubled", async () => {
    const d = await deps(async () => ({ kind: "network_error" }));
    const it1 = item();
    const a = buildPackets(it1, d.identity, d.centerPublicKey, Date.now());
    const b = buildPackets(it1, d.identity, d.centerPublicKey, Date.now() + 1000, ["other", "gw-2"]);
    await processPacket(a[0].packet, a[0].path);
    const second = await processPacket(b[0].packet, b[0].path);
    expect(second.status).toBe("duplicate");
    expect((await getState()).cases).toHaveLength(1);
  });

  it("includes audio fragments tied to the SOS", async () => {
    const d = await deps(async () => ({ kind: "network_error" }));
    const withAudio = item({ audio: new Uint8Array(130_000).fill(7) });
    const packets = buildPackets(withAudio, d.identity, d.centerPublicKey, Date.now());
    expect(packets.length).toBe(1 + 3); // SOS + ceil(130000 / 60000) fragments
    for (const p of packets) expect((await processPacket(p.packet, p.path)).status).toBe("accepted");
  });

  it("keeps items while offline and delivers them in order when the network returns", async () => {
    let online = false;
    const sent: string[] = [];
    const d = await deps(async (packets) => {
      if (!online) return { kind: "network_error" };
      const r = await processPacket(packets[0].packet, packets[0].path);
      sent.push(r.id!);
      return { kind: "result", status: r.status as "accepted", reason: r.reason };
    });
    const first = item({ createdAt: 1 });
    const second = item({ createdAt: 2 });
    await d.store.put(second);
    await d.store.put(first);

    expect(await flushOutbox(d)).toEqual({ delivered: 0, dropped: 0, remaining: 2 });
    online = true;
    expect(await flushOutbox(d)).toEqual({ delivered: 2, dropped: 0, remaining: 0 });
    expect(sent).toEqual([first.id, second.id]);
  });

  it("treats a replay answer as delivered (the first attempt got through, only its response was lost)", async () => {
    const d = await deps(async () => ({ kind: "result", status: "rejected", reason: "replay" }));
    await d.store.put(item());
    expect(await flushOutbox(d)).toMatchObject({ delivered: 1, remaining: 0 });
  });

  it("gives up on an item the server keeps refusing", async () => {
    const d = await deps(async () => ({ kind: "result", status: "rejected", reason: "invalid_payload" }));
    await d.store.put(item());
    let last = { delivered: 0, dropped: 0, remaining: 1 };
    for (let i = 0; i < MAX_ATTEMPTS; i++) last = await flushOutbox(d);
    expect(last).toEqual({ delivered: 0, dropped: 1, remaining: 0 });
  });

  it("caches the (public) center key for offline starts", async () => {
    const store: Record<string, string> = {};
    const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) };
    expect(await loadCenterKey(async () => "KEY1", storage)).toBe("KEY1");
    expect(await loadCenterKey(async () => { throw new Error("offline"); }, storage)).toBe("KEY1");
    expect(await loadCenterKey(async () => { throw new Error("offline"); }, null)).toBeNull();
  });
});
