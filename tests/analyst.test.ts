import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localConfig } from "../src/lib/ai/config";
import { runCrossCheck, runHandover, runTriage, selectMode, providersFor, MODE_LABEL } from "../src/lib/ai/orchestrator";
import { probeLocalLlm } from "../src/lib/ai/local";
import { crossCheckByRules, handoverByRules, type HandoverInput } from "../src/lib/ai/reports";
import { containsMedicalAdvice } from "../src/lib/ai/safety";
import { mockProviders } from "../src/lib/ai/mock";
import type { ProviderSet, TriageInput } from "../src/lib/ai/types";
import type { Case, Metrics } from "../src/lib/domain/types";
import { buildHandoverInput, computeImpact } from "../src/lib/impact";
import { getRepository } from "../src/lib/repo";
import { resetRuntime } from "../src/lib/server/runtime";
import { getCenterKeys } from "../src/lib/server/center";
import { addFieldPhoto, crossCheckCase, buildHandover, getState, processPacket, setOffline } from "../src/lib/server/service";
import { buildSosPacket, generateIdentity, initCrypto, toBase64 } from "../src/lib/packet";

const photo = (findings: { phrase: string; count: number }[]) => ({ findings: findings.map((f) => ({ ...f, masks: [] })) });
const report = { type: "trapped" as const, reportedPeople: 4, trapped: true, hasBabies: false, coherence: 0.9 };

describe("cross-check rules (mock + fallback)", () => {
  it("needs a photo: insufficient without imagery", () => {
    expect(crossCheckByRules({ report, photos: [] }).verdict).toBe("insufficient");
  });
  it("is consistent when imagery shows people and a collapsed structure", () => {
    const r = crossCheckByRules({ report, photos: [photo([{ phrase: "person", count: 3 }, { phrase: "collapsed structure", count: 1 }])] });
    expect(r.verdict).toBe("consistent");
    expect(r.reasons.join(" ")).toMatch(/supports the reported entrapment/);
  });
  it("contradicts when imagery shows neither people nor collapse", () => {
    const r = crossCheckByRules({ report, photos: [photo([{ phrase: "person", count: 0 }, { phrase: "collapsed structure", count: 0 }])] });
    expect(r.verdict).toBe("contradictory");
  });
  it("flags incoherent audio even without photos", () => {
    expect(crossCheckByRules({ report: { ...report, coherence: 0.1 }, photos: [] }).verdict).toBe("contradictory");
  });
  it("never produces medical language", () => {
    const r = crossCheckByRules({ report, photos: [photo([{ phrase: "person", count: 1 }, { phrase: "blocked road", count: 2 }])] });
    expect(r.reasons.some(containsMedicalAdvice)).toBe(false);
  });
});

describe("handover rules", () => {
  const snap: HandoverInput = {
    generatedAt: 0,
    activeByPriority: { P1: 3, P2: 4, P3: 2, P4: 1 },
    oldestP1WaitMin: 25,
    unassignedP1: 2,
    flaggedForReview: 1,
    teams: { total: 6, available: 3, assigned: 2, dispatched: 1 },
    defenses: { duplicatesMerged: 100, replaysBlocked: 2, rejected: 5 },
    contradictoryCrossChecks: 1,
    photos: 0,
    top: [{ id: "a", priority: "P1", type: "trapped", people: 3, waitMin: 25, assigned: false }],
  };
  it("reports only numbers from the snapshot and concrete next actions", () => {
    const h = handoverByRules(snap);
    expect(h.headline).toContain("10 active");
    expect(h.risks.join(" ")).toContain("2 critical (P1)");
    expect(h.nextActions.join(" ")).toMatch(/Recommend assignment/);
    expect([h.headline, ...h.summary, ...h.risks, ...h.nextActions].some(containsMedicalAdvice)).toBe(false);
  });
});

describe("orchestrator fallbacks for the analyst tasks", () => {
  it("falls back to rules when Wonder throws or returns junk", async () => {
    const broken: ProviderSet = { ...mockProviders, source: "meta", analyst: { ...mockProviders.analyst!, crossCheck: async () => { throw new Error("HTTP 500"); }, handover: async () => ({ junk: true }) as never } };
    const cc = await runCrossCheck({ report, photos: [] }, { mode: "meta", providers: broken });
    expect(cc.source).toBe("rules");
    const ho = await runHandover({ generatedAt: 0, activeByPriority: { P1: 0, P2: 0, P3: 0, P4: 0 }, oldestP1WaitMin: 0, unassignedP1: 0, flaggedForReview: 0, teams: { total: 0, available: 0, assigned: 0, dispatched: 0 }, defenses: { duplicatesMerged: 0, replaysBlocked: 0, rejected: 0 }, contradictoryCrossChecks: 0, photos: 0, top: [] }, { mode: "meta", providers: broken });
    expect(ho.source).toBe("rules");
  });
  it("rejects model output with medical language", async () => {
    const bad: ProviderSet = { ...mockProviders, source: "meta", analyst: { ...mockProviders.analyst!, crossCheck: async () => ({ verdict: "consistent" as const, reasons: ["Apply a tourniquet to the victim."] }) } };
    expect((await runCrossCheck({ report, photos: [] }, { mode: "meta", providers: bad })).source).toBe("rules");
  });
});

describe("level 2: local Llama (Ollama-compatible server)", () => {
  const input: TriageInput = { type: "trapped", who: ["baby"], count: 3, lat: 3.45, lon: -76.53, waitMinutes: 4 };
  let server: http.Server;
  let url = "";
  let mode: "ok" | "junk" | "down" = "ok";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (mode === "down") return void req.destroy();
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/tags") return void res.end(JSON.stringify({ models: [] }));
      const content = mode === "ok"
        ? JSON.stringify({ emergencyType: "trapped", people: 3, hasBabies: true, hasChildren: false, hasElderly: false, trapped: true, priority: "P1", justification: "Three people trapped, one baby: send a rescue team first.", coherence: 0.9 })
        : "not json";
      res.end(JSON.stringify({ message: { content } }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => void server.close());
  beforeEach(() => { mode = "ok"; });

  it("selects the local level only when a local model is configured and the internet is down", () => {
    expect(selectMode(true, undefined, localConfig({ LOCAL_LLM_URL: url }))).toBe("local");
    expect(selectMode(true, undefined, localConfig({}))).toBe("rules");
    expect(selectMode(false, undefined, localConfig({ LOCAL_LLM_URL: url }))).toBe("mock");
    expect(MODE_LABEL.local).toBe("OFFLINE: LOCAL LLAMA");
  });
  it("triages with the local model", async () => {
    const t = await runTriage(input, { mode: "local", providers: providersFor("local", undefined, localConfig({ LOCAL_LLM_URL: url })) });
    expect(t.source).toBe("local");
    expect(t.priority).toBe("P1");
  });
  it("degrades to rules when the local model answers junk or is down", async () => {
    mode = "junk";
    expect((await runTriage(input, { mode: "local", providers: providersFor("local", undefined, localConfig({ LOCAL_LLM_URL: url })) })).source).toBe("rules");
    mode = "down";
    expect((await runTriage(input, { mode: "local", providers: providersFor("local", undefined, localConfig({ LOCAL_LLM_URL: url, LOCAL_LLM_TIMEOUT_MS: "500" })) })).source).toBe("rules");
  });
  it("probes reachability", async () => {
    expect(await probeLocalLlm(localConfig({ LOCAL_LLM_URL: url }))).toBe(true);
    expect(await probeLocalLlm(localConfig({}))).toBe(false);
  });
});

describe("impact metrics and the multimodal flow in the service", () => {
  beforeAll(initCrypto);
  beforeEach(async () => {
    await getRepository().reset();
    resetRuntime();
    setOffline(false);
  });
  async function newCase(over: Partial<Parameters<typeof buildSosPacket>[0]> = {}) {
    const center = await getCenterKeys();
    const pkt = buildSosPacket({ type: "trapped", who: ["baby"], count: 3, lat: 3.45, lon: -76.53, ...over }, { identity: await generateIdentity(), centerPublicKey: center.publicKey });
    return (await processPacket(toBase64(pkt), ["n1", "gw-1"])).id!;
  }

  it("computeImpact counts people at risk, unassigned criticals and coverage", async () => {
    await newCase();
    await newCase({ type: "other", who: ["adult"], count: 1 });
    const s = await getState();
    expect(s.impact.activeCases).toBe(2);
    expect(s.impact.peopleAtRisk).toBeGreaterThanOrEqual(3);
    expect(s.impact.criticalUnassigned).toBeGreaterThanOrEqual(1);
    expect(s.impact.manualMinutesSaved).toBeGreaterThanOrEqual(3);
    expect(s.impact.coveragePct).toBe(0);
    expect(s.localLlm.configured).toBe(false);
  });

  it("cross-check without photos is insufficient and does not change confidence", async () => {
    const id = await newCase();
    const before = (await getState()).cases[0].trust!.score;
    expect((await crossCheckCase(id)).ok).toBe(true);
    const c = (await getState()).cases[0];
    expect(c.crossCheck?.verdict).toBe("insufficient");
    expect(c.trust!.score).toBe(before);
  });

  it("cross-check with a photo adds a signal and is recorded in the history", async () => {
    const id = await newCase();
    const img = "data:image/jpeg;base64," + Buffer.from("fake-image-bytes-for-test").toString("base64");
    await addFieldPhoto(id, img);
    await crossCheckCase(id);
    const c = (await getState()).cases[0];
    expect(["consistent", "contradictory"]).toContain(c.crossCheck!.verdict);
    expect(c.trust!.signals.some((s) => s.id === "cross_check")).toBe(true);
    expect(c.events.some((e) => e.kind === "cross_check")).toBe(true);
    expect(c.status).not.toBe("closed"); // never discarded
  });

  it("builds a handover report from real state, offline too", async () => {
    await newCase();
    const online = await buildHandover();
    expect(online.headline).toMatch(/active/);
    setOffline(true);
    const offline = await buildHandover();
    expect(offline.source).toBe("rules");
    expect(offline.modeLabel).toBe("OFFLINE: RULES");
  });

  it("pure helpers agree with each other", () => {
    const m: Metrics = { received: 5, accepted: 4, duplicates: 7, replaysBlocked: 2, rejected: 3 };
    expect(computeImpact([] as Case[], m, 0, 0).attacksBlocked).toBe(5);
    expect(buildHandoverInput([], [], m, 0).defenses).toEqual({ duplicatesMerged: 7, replaysBlocked: 2, rejected: 3 });
  });
});
