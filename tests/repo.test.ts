import { beforeEach, describe, expect, it } from "vitest";
import type { Case, EarthquakeEvent, Team } from "../src/lib/domain/types";
import { MemoryRepository } from "../src/lib/repo/memory";
import type { Repository } from "../src/lib/repo/Repository";
import {
  SupabaseRepository,
  assembleFragments,
  base64ToBytes,
  bytesToBase64,
  caseToRow,
  eventToRow,
  rejectionToRow,
  rowToCase,
  rowToEvent,
  rowToRejection,
  rowToSeen,
  rowToTeam,
  rowsToMetrics,
  seenToRow,
  teamToRow,
} from "../src/lib/repo/supabase";
import { getRepository, supabaseConfigured } from "../src/lib/repo";

const baseCase = (over: Partial<Case> = {}): Case => ({
  id: "a1b2c3", senderId: "deadbeef", senderKey: "deadbeef".repeat(8), sentAt: 1_800_000_000_000, receivedAt: 1_800_000_005_000,
  type: "trapped", who: ["baby", "adult"], count: 3, lat: 3.4516, lon: -76.532, paths: [["n1", "gw-1"], ["n2", "n3", "gw-2"]],
  status: "new", priority: "P2", needsReview: false, photos: [], events: [{ at: 1_800_000_005_000, kind: "received", note: "SOS received" }],
  ...over,
});
const fullCase = (): Case =>
  baseCase({
    id: "ff00ff",
    triage: { emergencyType: "trapped", people: 3, hasBabies: true, hasChildren: false, hasElderly: false, trapped: true, priority: "P1", justification: "Rules: people trapped.", coherence: 0.9, source: "rules", latencyMs: 2 },
    trust: { score: 88, lowConfidence: false, signals: [{ id: "signature", label: "Signature", value: 1, weight: 0.15, detail: "ok" }] },
    transcript: { text: "estamos atrapados", source: "mock" },
    audio: { bytes: 1000, codec2TheoreticalBytes: 900, seconds: 4 },
    photos: [{ id: "ph-1", uploadedAt: 1, dataUrl: "data:image/jpeg;base64,AAAA", findings: [{ phrase: "person", count: 1, masks: [] }], source: "mock" }],
    assignedTeamId: "eq-1",
    triagedAt: 1_800_000_006_000,
  });

// ---------------------------------------------------------------------------
// Pure row <-> domain mapping (no network)
// ---------------------------------------------------------------------------
describe("SupabaseRepository row mapping", () => {
  it("round-trips a minimal and a full case", () => {
    for (const c of [baseCase(), fullCase()]) expect(rowToCase(caseToRow(c))).toEqual(c);
  });

  it("keeps future Case fields inside the jsonb data column", () => {
    const c = { ...baseCase(), crossCheck: { verdict: "consistent", reasons: ["photo matches"], source: "meta", at: 5 } } as Case;
    const row = caseToRow(c);
    expect(row.data).toHaveProperty("crossCheck");
    expect(rowToCase(row)).toEqual(c);
  });

  it("derives the indexed columns from the case", () => {
    const row = caseToRow(fullCase());
    expect(row).toMatchObject({ id: "ff00ff", sender_key: "deadbeef".repeat(8), status: "new", priority: "P2", needs_review: false, received_at: 1_800_000_005_000 });
  });

  it("lets the indexed columns override stale jsonb (manual SQL edits are honoured) and accepts bigint strings", () => {
    const row = caseToRow(baseCase());
    const edited = rowToCase({ ...row, status: "closed", priority: "P4", needs_review: true, received_at: "1800000009000" });
    expect(edited).toMatchObject({ status: "closed", priority: "P4", needsReview: true, receivedAt: 1_800_000_009_000 });
  });

  it("maps teams, seen records, rejections and events", () => {
    const t: Team = { id: "eq-1", name: "Alpha", size: 6, lat: 3.45, lon: -76.53, status: "assigned" };
    expect(rowToTeam(teamToRow(t))).toEqual(t);
    expect(rowToSeen(seenToRow("id1", { firstSeen: 5, pathKeys: ["a", "a>b"] }))).toEqual({ firstSeen: 5, pathKeys: ["a", "a>b"] });
    expect(rowToRejection(rejectionToRow({ at: 9, reason: "replay", id: "abc" }))).toEqual({ at: 9, reason: "replay", id: "abc" });
    expect(rowToRejection(rejectionToRow({ at: 9, reason: "malformed" }))).toEqual({ at: 9, reason: "malformed" });
    const e: EarthquakeEvent = { id: "e1", time: 1, lat: 3, lon: -76, magnitude: 6.1, place: "Cali", simulated: true };
    expect(rowToEvent(eventToRow(e))).toEqual(e);
  });

  it("builds metrics with zeros for missing keys and ignores unknown ones", () => {
    expect(rowsToMetrics([{ key: "received", value: "7" }, { key: "accepted", value: 3 }, { key: "bogus", value: 99 }])).toEqual({ received: 7, accepted: 3, duplicates: 0, replaysBlocked: 0, rejected: 0 });
  });

  it("encodes bytes as base64 and reassembles fragments in index order", () => {
    const bytes = Uint8Array.of(0, 1, 2, 253, 254, 255);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
    const rows = [{ idx: 1, data: bytesToBase64(Uint8Array.of(3, 4)) }, { idx: 0, data: bytesToBase64(Uint8Array.of(1, 2)) }];
    expect([...assembleFragments(rows, 2)!]).toEqual([1, 2, 3, 4]);
    expect(assembleFragments(rows.slice(0, 1), 2)).toBeNull();
  });
});

describe("repository selection", () => {
  it("uses Supabase only when both env vars are present", () => {
    expect(supabaseConfigured({})).toBe(false);
    expect(supabaseConfigured({ SUPABASE_URL: "https://x.supabase.co" })).toBe(false);
    expect(supabaseConfigured({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" })).toBe(true);
  });
  it("SupabaseRepository.fromEnv refuses to start without credentials", () => {
    expect(() => SupabaseRepository.fromEnv({})).toThrow(/SUPABASE_URL/);
  });
  it("falls back to the in-memory singleton without credentials", () => {
    if (supabaseConfigured()) return; // running against a real project: nothing to assert here
    expect(getRepository()).toBe(getRepository());
    expect(getRepository()).toBeInstanceOf(MemoryRepository);
  });
});

// ---------------------------------------------------------------------------
// Contract: the same behaviour for every Repository implementation.
// MemoryRepository always runs. SupabaseRepository runs only against a real project, and because the
// suite calls reset() (it TRUNCATES every table) it additionally requires SOLARIS_REPO_TEST_RESET=1.
// Use a throwaway Supabase project for this, never the demo/production one.
// ---------------------------------------------------------------------------
const runSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SOLARIS_REPO_TEST_RESET === "1";

const implementations: [string, () => Repository, boolean][] = [
  ["MemoryRepository", () => new MemoryRepository(), true],
  ["SupabaseRepository (integration)", () => SupabaseRepository.fromEnv(), runSupabase],
];

for (const [name, make, enabled] of implementations) {
  describe.skipIf(!enabled)(`Repository contract: ${name}`, () => {
    let repo: Repository;
    beforeEach(async () => {
      repo = make();
      await repo.reset();
    });

    it("stores, updates and lists cases", async () => {
      const a = fullCase();
      const b = baseCase({ id: "bb", receivedAt: 1_800_000_009_000 });
      await repo.saveCase(a);
      await repo.saveCase(b);
      expect(await repo.getCase("ff00ff")).toEqual(a);
      expect(await repo.getCase("missing")).toBeUndefined();
      await repo.saveCase({ ...a, status: "validated", priority: "P1" });
      expect((await repo.getCase("ff00ff"))?.status).toBe("validated");
      const ids = (await repo.listCases()).map((c) => c.id).sort();
      expect(ids).toEqual(["bb", "ff00ff"]);
    });

    it("stores teams", async () => {
      const t: Team = { id: "eq-1", name: "Alpha", size: 6, lat: 3.45, lon: -76.53, status: "available" };
      await repo.saveTeam(t);
      await repo.saveTeam({ ...t, status: "dispatched" });
      expect(await repo.listTeams()).toEqual([{ ...t, status: "dispatched" }]);
    });

    it("keeps the replay registry, accumulating path keys without losing first_seen", async () => {
      expect(await repo.getSeen("m1")).toBeUndefined();
      await repo.putSeen("m1", { firstSeen: 1000, pathKeys: ["a"] });
      await repo.putSeen("m1", { firstSeen: 1000, pathKeys: ["a", "b"] });
      expect(await repo.getSeen("m1")).toEqual({ firstSeen: 1000, pathKeys: ["a", "b"] });
    });

    it("counts sender events inside a time window", async () => {
      await repo.recordSenderEvent("k1", 1000);
      await repo.recordSenderEvent("k1", 2000);
      await repo.recordSenderEvent("k2", 2000);
      expect(await repo.countSenderEvents("k1", 0)).toBe(2);
      expect(await repo.countSenderEvents("k1", 1500)).toBe(1);
      expect(await repo.countSenderEvents("k3", 0)).toBe(0);
    });

    it("keeps a revocation list", async () => {
      expect(await repo.isRevoked("k1")).toBe(false);
      await repo.revoke("k1");
      await repo.revoke("k1");
      expect(await repo.isRevoked("k1")).toBe(true);
    });

    it("reassembles fragmented audio in order, exactly once", async () => {
      expect(await repo.addAudioFragment("p1", "k1", 1, 2, Uint8Array.of(3, 4))).toBeNull();
      const whole = await repo.addAudioFragment("p1", "k1", 0, 2, Uint8Array.of(1, 2));
      expect([...whole!]).toEqual([1, 2, 3, 4]);
      expect(await repo.addAudioFragment("p1", "k1", 0, 2, Uint8Array.of(9))).toBeNull(); // a new audio started, incomplete
    });

    it("rejects audio from another identity, a bad index and a bad total", async () => {
      await repo.addAudioFragment("p2", "owner", 0, 2, Uint8Array.of(1));
      expect(await repo.addAudioFragment("p2", "intruder", 1, 2, Uint8Array.of(2))).toBeNull();
      expect(await repo.addAudioFragment("p3", "k", 5, 2, Uint8Array.of(1))).toBeNull();
      expect(await repo.addAudioFragment("p3", "k", 0, 99, Uint8Array.of(1))).toBeNull();
      expect(await repo.addAudioFragment("p3", "k", 0, 0, Uint8Array.of(1))).toBeNull();
    });

    it("logs rejections oldest-first", async () => {
      await repo.logRejection({ at: 1, reason: "replay", id: "m1" });
      await repo.logRejection({ at: 2, reason: "bad_signature" });
      expect(await repo.listRejections()).toEqual([{ at: 1, reason: "replay", id: "m1" }, { at: 2, reason: "bad_signature" }]);
    });

    it("counts metrics atomically", async () => {
      expect(await repo.getMetrics()).toEqual({ received: 0, accepted: 0, duplicates: 0, replaysBlocked: 0, rejected: 0 });
      await Promise.all([repo.bumpMetric("received"), repo.bumpMetric("received"), repo.bumpMetric("accepted", 5)]);
      expect(await repo.getMetrics()).toMatchObject({ received: 2, accepted: 5 });
    });

    it("stores seismic events and replaces them on set", async () => {
      const e1: EarthquakeEvent = { id: "e1", time: 1, lat: 3, lon: -76, magnitude: 6.1, place: "Cali", simulated: true };
      const e2 = { ...e1, id: "e2" };
      await repo.setEvents([e1, e2]);
      expect((await repo.getEvents()).map((e) => e.id).sort()).toEqual(["e1", "e2"]);
      await repo.setEvents([e2]);
      expect((await repo.getEvents()).map((e) => e.id)).toEqual(["e2"]);
    });

    it("reset wipes everything", async () => {
      await repo.saveCase(baseCase());
      await repo.saveTeam({ id: "t", name: "T", size: 1, lat: 0, lon: 0, status: "available" });
      await repo.putSeen("m", { firstSeen: 1, pathKeys: [] });
      await repo.revoke("k");
      await repo.bumpMetric("received");
      await repo.reset();
      expect(await repo.listCases()).toEqual([]);
      expect(await repo.listTeams()).toEqual([]);
      expect(await repo.getSeen("m")).toBeUndefined();
      expect(await repo.isRevoked("k")).toBe(false);
      expect((await repo.getMetrics()).received).toBe(0);
    });
  });
}
