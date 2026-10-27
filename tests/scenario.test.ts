import { beforeAll, describe, expect, it } from "vitest";
import { initCrypto } from "../src/lib/packet";
import { getState, setOffline } from "../src/lib/server/service";
import { loadCaliScenario, runBenchmark } from "../src/lib/server/scenarioRunner";
import { containsMedicalAdvice } from "../src/lib/ai/safety";

describe("Cali 2026 scenario", () => {
  beforeAll(initCrypto);

  it("exercises every defence and never discards low-confidence cases", async () => {
    setOffline(false);
    const run = await loadCaliScenario();
    const s = await getState();
    expect(run.outcome.accepted).toBeGreaterThanOrEqual(40);
    expect(run.outcome.duplicates).toBeGreaterThan(10); // same message via several gateways
    expect(run.outcome.rejectedByReason).toMatchObject({ bad_signature: 1, replay: 2, revoked: 1 });
    expect(run.outcome.rejectedByReason.rate_limited).toBeGreaterThanOrEqual(1);
    expect(s.events[0].simulated).toBe(true);
    // the false SOS is kept, flagged and demoted
    const flagged = s.cases.filter((c) => c.needsReview);
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    expect(flagged.every((c) => c.status === "new")).toBe(true);
    // priorities are mixed and every case carries a trust breakdown
    expect(new Set(s.cases.map((c) => c.priority)).size).toBeGreaterThanOrEqual(3);
    expect(s.cases.every((c) => c.trust && c.triage)).toBe(true);
    expect(s.cases.some((c) => c.paths.length > 1)).toBe(true);
    expect(s.cases.every((c) => !containsMedicalAdvice(c.triage!.justification))).toBe(true);
  });

  it("keeps working with the internet down (rules only)", async () => {
    setOffline(true);
    const run = await loadCaliScenario();
    const s = await getState();
    expect(run.outcome.accepted).toBeGreaterThanOrEqual(40);
    expect(s.cases.every((c) => c.triage?.source === "rules")).toBe(true);
    setOffline(false);
  });

  it("benchmark runs in isolation and leaves live state untouched", async () => {
    await loadCaliScenario();
    const before = (await getState()).cases.length;
    const b = await runBenchmark(100);
    expect(b.count).toBe(100);
    expect(b.manualMinutes).toBe(200);
    expect((await getState()).cases.length).toBe(before);
  });
});
