import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingest, type IngestContext } from "../src/lib/ingest/pipeline";
import { ingestConfig } from "../src/lib/config";
import { MemoryRepository } from "../src/lib/repo/memory";
import {
  buildAudioPacket,
  buildSosPacket,
  generateCenterKeys,
  generateIdentity,
  initCrypto,
  randomBytes,
  toHex,
  type SosPayload,
} from "../src/lib/packet";

const sos: SosPayload = { type: "injured", who: ["adult"], count: 2, lat: 3.45, lon: -76.53 };
const NOW = 1_800_000_000_000;

describe("secure ingest", () => {
  let center: Awaited<ReturnType<typeof generateCenterKeys>>;
  let id: Awaited<ReturnType<typeof generateIdentity>>;
  let repo: MemoryRepository;
  let ctx: IngestContext;

  beforeAll(async () => {
    await initCrypto();
    center = await generateCenterKeys();
  });
  beforeEach(async () => {
    id = await generateIdentity();
    repo = new MemoryRepository();
    ctx = { repo, center, config: ingestConfig({}), now: NOW };
  });
  const pkt = (o: Record<string, unknown> = {}, who = id) =>
    buildSosPacket(sos, { identity: who, centerPublicKey: center.publicKey, timestamp: NOW / 1000, ...o });

  it("accepts a valid SOS and stores it", async () => {
    const r = await ingest({ packet: pkt(), path: ["n1", "gw"] }, ctx);
    expect(r.status).toBe("accepted");
    expect((await repo.listCases()).length).toBe(1);
  });

  it("rejects an invalid signature", async () => {
    const other = await generateIdentity();
    const forged = pkt({}, { publicKey: id.publicKey, secretKey: other.secretKey });
    const r = await ingest({ packet: forged }, ctx);
    expect(r).toMatchObject({ status: "rejected", reason: "bad_signature" });
  });

  it("rejects garbage as malformed or undecryptable", async () => {
    const r = await ingest({ packet: randomBytes(120) }, ctx);
    expect(r.status).toBe("rejected");
  });

  it("merges the same message arriving by another path as a duplicate", async () => {
    const p = pkt();
    await ingest({ packet: p, path: ["a", "gw"] }, ctx);
    const r2 = await ingest({ packet: p, path: ["b", "c", "gw"] }, { ...ctx, now: NOW + 5_000 });
    expect(r2).toMatchObject({ status: "duplicate", paths: 2 });
    const [c] = await repo.listCases();
    expect(c.paths.length).toBe(2);
    expect((await repo.listCases()).length).toBe(1);
    expect((await repo.getMetrics()).duplicates).toBe(1);
  });

  it("blocks a replay of the same path as replay", async () => {
    const p = pkt();
    await ingest({ packet: p, path: ["a", "gw"] }, ctx);
    const r2 = await ingest({ packet: p, path: ["a", "gw"] }, { ...ctx, now: NOW + 5_000 });
    expect(r2).toMatchObject({ status: "rejected", reason: "replay" });
    expect((await repo.getMetrics()).replaysBlocked).toBe(1);
  });

  it("blocks a late re-send via a new path after the dedup window", async () => {
    const p = pkt();
    await ingest({ packet: p, path: ["a"] }, ctx);
    const r = await ingest({ packet: p, path: ["z"] }, { ...ctx, now: NOW + 200_000 });
    expect(r).toMatchObject({ status: "rejected", reason: "replay" });
  });

  it("rejects timestamps outside the replay window (old and future)", async () => {
    const old = await ingest({ packet: pkt({ timestamp: NOW / 1000 - 3600 }) }, ctx);
    const future = await ingest({ packet: pkt({ timestamp: NOW / 1000 + 3600 }) }, ctx);
    expect(old).toMatchObject({ reason: "stale_timestamp" });
    expect(future).toMatchObject({ reason: "stale_timestamp" });
  });

  it("rate limits per identity", async () => {
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await ingest({ packet: pkt() }, ctx));
    expect(results.filter((r) => r.status === "accepted").length).toBe(5);
    expect(results.filter((r) => r.status === "rejected" && r.reason === "rate_limited").length).toBe(2);
  });

  it("does not let duplicates consume the rate limit", async () => {
    const p = pkt();
    for (let i = 0; i < 10; i++) await ingest({ packet: p, path: [`p${i}`] }, ctx);
    const r = await ingest({ packet: pkt() }, ctx);
    expect(r.status).toBe("accepted");
  });

  it("rejects revoked identities", async () => {
    await repo.revoke(toHex(id.publicKey));
    expect(await ingest({ packet: pkt() }, ctx)).toMatchObject({ reason: "revoked" });
  });

  it("reassembles fragmented audio", async () => {
    const sosPkt = pkt();
    const r = await ingest({ packet: sosPkt }, ctx);
    if (r.status !== "accepted" || r.kind !== "sos") throw new Error("setup");
    const parent = Uint8Array.from(Buffer.from(r.case.id, "hex"));
    const parts = [Uint8Array.of(1, 2), Uint8Array.of(3, 4)];
    let whole: Uint8Array | undefined;
    for (let i = 0; i < parts.length; i++) {
      const a = buildAudioPacket(
        { parentId: parent, index: i, total: 2, data: parts[i] },
        { identity: id, centerPublicKey: center.publicKey, timestamp: NOW / 1000 },
      );
      const res = await ingest({ packet: a }, ctx);
      if (res.status === "accepted" && res.kind === "audio") whole = res.audio;
    }
    expect([...whole!]).toEqual([1, 2, 3, 4]);
  });

  it("does not let another identity inject audio fragments", async () => {
    const r = await ingest({ packet: pkt() }, ctx);
    if (r.status !== "accepted" || r.kind !== "sos") throw new Error("setup");
    const parent = Uint8Array.from(Buffer.from(r.case.id, "hex"));
    const mk = (who: typeof id, index: number) =>
      buildAudioPacket({ parentId: parent, index, total: 2, data: Uint8Array.of(index) }, { identity: who, centerPublicKey: center.publicKey, timestamp: NOW / 1000 });
    await ingest({ packet: mk(id, 0) }, ctx);
    const evil = await generateIdentity();
    const res = await ingest({ packet: mk(evil, 1) }, ctx);
    expect(res).toMatchObject({ status: "accepted", kind: "audio" });
    expect((res as { audio?: Uint8Array }).audio).toBeUndefined();
  });
});
