import { describe, expect, it, vi } from "vitest";
import { runAnalyst, runTriage, selectMode, providersFor } from "../src/lib/ai/orchestrator";
import { triageByRules } from "../src/lib/ai/rules";
import { mockProviders, SIMULATED_AUDIO_PREFIX } from "../src/lib/ai/mock";
import { containsMedicalAdvice } from "../src/lib/ai/safety";
import { triageOutputSchema, analystOutputSchema } from "../src/lib/ai/schemas";
import { metaConfig } from "../src/lib/ai/config";
import type { ProviderSet, TriageInput } from "../src/lib/ai/types";
import type { Case, Team } from "../src/lib/domain/types";
import { computeTrust, LOW_CONFIDENCE_THRESHOLD } from "../src/lib/trust/score";
import { applyTrustToPriority, greedyAssignment, sortCases } from "../src/lib/priority/queue";

const base: TriageInput = { type: "trapped", who: ["baby", "adult"], count: 3, lat: 3.45, lon: -76.53, waitMinutes: 5 };

describe("level 3 rules", () => {
  it("outputs the same shape as the Spark schema", () => {
    expect(() => triageOutputSchema.parse(triageByRules(base))).not.toThrow();
  });
  it("prioritises trapped family with a baby above a lone minor report", () => {
    const high = triageByRules(base);
    const low = triageByRules({ ...base, type: "other", who: ["adult"], count: 1 });
    expect(high.priority).toBe("P1");
    expect(low.priority).toBe("P4");
  });
  it("uses transcript keywords", () => {
    const r = triageByRules({ ...base, type: "other", who: ["adult"], count: 1, transcript: "Estamos atrapados bajo los escombros, hay un bebé" });
    expect(r.trapped).toBe(true);
    expect(r.hasBabies).toBe(true);
    expect(["P1", "P2"]).toContain(r.priority);
  });
  it("lowers coherence for joke text", () => {
    expect(triageByRules({ ...base, transcript: "jajaja es una broma" }).coherence).toBeLessThan(0.3);
  });
  it("raises priority with waiting time", () => {
    const a = triageByRules({ ...base, type: "injured", who: ["adult"], count: 1, waitMinutes: 0 });
    const b = triageByRules({ ...base, type: "injured", who: ["adult"], count: 1, waitMinutes: 180 });
    expect(["P1", "P2", "P3", "P4"].indexOf(b.priority)).toBeLessThan(["P1", "P2", "P3", "P4"].indexOf(a.priority));
  });
});

describe("medical-advice guard", () => {
  it("never emits medical language from rules or mock for any emergency type", async () => {
    for (const type of ["trapped", "injured", "bleeding", "fire", "other"] as const) {
      const rules = triageByRules({ ...base, type });
      const mock = await mockProviders.triage.triage({ ...base, type });
      expect(containsMedicalAdvice(rules.justification)).toBe(false);
      expect(containsMedicalAdvice(mock.justification)).toBe(false);
    }
  });
  it("replaces model output that contains medical advice", async () => {
    const bad: ProviderSet = {
      ...mockProviders,
      source: "meta",
      triage: { triage: async () => ({ ...triageByRules(base), justification: "Aplique un torniquete en la pierna." }) },
    };
    const t = await runTriage(base, { mode: "meta", providers: bad });
    expect(containsMedicalAdvice(t.justification)).toBe(false);
    expect(t.source).toBe("meta");
  });
});

describe("mode selection and graceful degradation", () => {
  it("no key => mock, key => meta, offline => rules", () => {
    expect(selectMode(false, metaConfig({}))).toBe("mock");
    expect(selectMode(false, metaConfig({ META_API_KEY: "x" }))).toBe("meta");
    expect(selectMode(true, metaConfig({ META_API_KEY: "x" }))).toBe("rules");
    expect(providersFor("rules")).toBeNull();
  });
  it("falls back to rules when the provider throws", async () => {
    const onDegrade = vi.fn();
    const broken: ProviderSet = { ...mockProviders, source: "meta", triage: { triage: async () => { throw new Error("HTTP 500"); } } };
    const t = await runTriage(base, { mode: "meta", providers: broken, onDegrade });
    expect(t.source).toBe("rules");
    expect(onDegrade).toHaveBeenCalledWith("triage", expect.stringContaining("500"));
  });
  it("falls back to rules when the output does not validate", async () => {
    const junk: ProviderSet = { ...mockProviders, source: "meta", triage: { triage: async () => ({ priority: "URGENT" }) as never } };
    expect((await runTriage(base, { mode: "meta", providers: junk })).source).toBe("rules");
  });
  it("mock triage is deterministic", async () => {
    const a = await runTriage({ ...base, transcript: "somos cinco personas" }, { mode: "mock" });
    const b = await runTriage({ ...base, transcript: "somos cinco personas" }, { mode: "mock" });
    expect(a.people).toBe(5);
    expect({ ...a, latencyMs: 0 }).toEqual({ ...b, latencyMs: 0 });
  });
  it("mock transcription decodes the simulated audio fixture", async () => {
    const audio = new TextEncoder().encode(SIMULATED_AUDIO_PREFIX + "hay un bebé atrapado");
    expect((await mockProviders.transcription.transcribe({ audio, keywords: [], language: "es" })).text).toBe("hay un bebé atrapado");
  });
});

const teams: Team[] = [
  { id: "t1", name: "Team North", size: 6, lat: 3.46, lon: -76.53, status: "available" },
  { id: "t2", name: "Team South", size: 4, lat: 3.4, lon: -76.53, status: "available" },
  { id: "t3", name: "Ocupado", size: 5, lat: 3.45, lon: -76.53, status: "dispatched" },
];

describe("analyst assignment", () => {
  const cases = [
    { id: "a", priority: "P1" as const, trust: 90, people: 3, type: "trapped" as const, trapped: true, lat: 3.461, lon: -76.53, waitMinutes: 20, justification: "x" },
    { id: "b", priority: "P3" as const, trust: 80, people: 1, type: "injured" as const, trapped: false, lat: 3.401, lon: -76.53, waitMinutes: 5, justification: "x" },
  ];
  it("gives the most urgent case the nearest free team and never a busy one", () => {
    const out = greedyAssignment({ cases, teams });
    expect(out.assignments.find((a) => a.caseId === "a")?.teamId).toBe("t1");
    expect(out.assignments.find((a) => a.caseId === "b")?.teamId).toBe("t2");
    expect(out.assignments.some((a) => a.teamId === "t3")).toBe(false);
    expect(() => analystOutputSchema.parse(out)).not.toThrow();
  });
  it("drops hallucinated or double-booked suggestions from the model", async () => {
    const p: ProviderSet = {
      ...mockProviders,
      source: "meta",
      analyst: { recommend: async () => ({ notes: "", assignments: [
        { caseId: "a", teamId: "t1", rationale: "cercano" },
        { caseId: "b", teamId: "t1", rationale: "doble reserva" },
        { caseId: "zzz", teamId: "t2", rationale: "inexistente" },
        { caseId: "b", teamId: "t3", rationale: "equipo ocupado" },
      ] }) },
    };
    const out = await runAnalyst({ cases, teams }, { mode: "meta", providers: p });
    expect(out.assignments).toEqual([{ caseId: "a", teamId: "t1", rationale: "cercano" }]);
  });
});

function mkCase(over: Partial<Case>): Case {
  return {
    id: "c" + Math.random(), senderId: "s", senderKey: "k" + Math.random(), sentAt: 1_800_000_000_000, receivedAt: 1_800_000_000_000,
    type: "trapped", who: [], count: 1, lat: 3.45, lon: -76.53, paths: [["n1"]], status: "new", priority: "P2", needsReview: false,
    photos: [], events: [], ...over,
  };
}
const quake = { id: "e", time: 1_800_000_000_000 - 600_000, lat: 3.45, lon: -76.53, magnitude: 6.1, place: "Cali", simulated: true };

describe("trust score", () => {
  const nodePosition = (id: string) => (id === "near" ? { lat: 3.45001, lon: -76.53 } : { lat: 3.5, lon: -76.6 });
  it("is high for a corroborated, coherent SOS near the quake with a close relay", () => {
    const c = mkCase({ paths: [["near"]], triage: { coherence: 0.9 } as never });
    const others = [mkCase({}), mkCase({ lat: 3.4503 })];
    const t = computeTrust(c, { now: c.sentAt, events: [quake], others, nodePosition });
    expect(t.score).toBeGreaterThan(80);
    expect(t.lowConfidence).toBe(false);
    expect(t.signals.map((s) => s.id)).toEqual(["signature", "seismic", "corroboration", "relay_proximity", "coherence"]);
  });
  it("is low for a far-away, joke SOS with an implausible relay", () => {
    const c = mkCase({ lat: 4.9, lon: -75.0, paths: [["far"]], triage: { coherence: 0.1 } as never });
    const t = computeTrust(c, { now: c.sentAt, events: [quake], others: [], nodePosition });
    expect(t.score).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    expect(t.lowConfidence).toBe(true);
  });
  it("a field photo with people adds to the score", () => {
    const photo = { id: "p", uploadedAt: 0, dataUrl: "", source: "mock" as const, findings: [{ phrase: "person", count: 1, masks: [] }] };
    const a = computeTrust(mkCase({ triage: { coherence: 0.5 } as never }), { now: 0, events: [], others: [] });
    const b = computeTrust(mkCase({ triage: { coherence: 0.5 } as never, photos: [photo] }), { now: 0, events: [], others: [] });
    expect(b.score).toBe(Math.min(100, a.score + 10));
  });
  it("revoked identity zeroes the signature signal", () => {
    const t = computeTrust(mkCase({}), { now: 0, events: [], others: [], revoked: true });
    expect(t.signals[0].value).toBe(0);
  });
});

describe("priority queue", () => {
  it("demotes but never discards low-confidence cases", () => {
    expect(applyTrustToPriority("P1", true)).toEqual({ priority: "P2", needsReview: true });
    expect(applyTrustToPriority("P4", true)).toEqual({ priority: "P4", needsReview: true });
    expect(applyTrustToPriority("P1", false)).toEqual({ priority: "P1", needsReview: false });
  });
  it("sorts by priority, then trust, and puts closed/false cases last", () => {
    const a = mkCase({ id: "a", priority: "P2", trust: { score: 50, signals: [], lowConfidence: false } });
    const b = mkCase({ id: "b", priority: "P1", trust: { score: 40, signals: [], lowConfidence: false } });
    const c = mkCase({ id: "c", priority: "P2", trust: { score: 90, signals: [], lowConfidence: false } });
    const f = mkCase({ id: "f", priority: "P1", status: "false" });
    expect(sortCases([a, b, c, f], "priority").map((x) => x.id)).toEqual(["b", "c", "a", "f"]);
    expect(sortCases([a, b, c, f], "trust").map((x) => x.id)).toEqual(["c", "a", "b", "f"]);
  });
});
