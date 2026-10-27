import { describe, expect, it } from "vitest";
import { DATASET } from "../eval/dataset";
import { evaluateMode } from "../scripts/eval-triage";
import {
  accuracy,
  coherenceDetection,
  confusionMatrix,
  p1Recall,
  perPriority,
  safetyRate,
  severeUnderTriageRate,
  withinOneAccuracy,
  type Pair,
} from "../src/lib/eval/metrics";

const pairs: Pair[] = [
  { expected: "P1", predicted: "P1" },
  { expected: "P1", predicted: "P2" },
  { expected: "P1", predicted: "P3" },
  { expected: "P2", predicted: "P2" },
  { expected: "P3", predicted: "P1" },
  { expected: "P4", predicted: "P4" },
];

describe("eval metrics", () => {
  it("builds the confusion matrix as [expected][predicted]", () => {
    const m = confusionMatrix(pairs);
    expect(m.P1.P1).toBe(1);
    expect(m.P1.P2).toBe(1);
    expect(m.P1.P3).toBe(1);
    expect(m.P3.P1).toBe(1);
    expect(Object.values(m).flatMap((r) => Object.values(r)).reduce((a, b) => a + b, 0)).toBe(pairs.length);
  });

  it("computes exact and within-one accuracy", () => {
    expect(accuracy(pairs)).toBeCloseTo(3 / 6);
    expect(withinOneAccuracy(pairs)).toBeCloseTo(4 / 6); // P1->P3 and P3->P1 are two levels off
  });

  it("computes per-priority precision and recall", () => {
    const s = perPriority(pairs);
    expect(s.P1.support).toBe(3);
    expect(s.P1.recall).toBeCloseTo(1 / 3);
    expect(s.P1.precision).toBeCloseTo(1 / 2); // predicted P1: one correct, one P3 that was over-prioritized
    expect(s.P2.recall).toBe(1);
    expect(s.P4.f1).toBe(1);
  });

  it("P1 recall and severe under-triage focus on critical cases", () => {
    expect(p1Recall(pairs)).toBeCloseTo(1 / 3);
    expect(severeUnderTriageRate(pairs)).toBeCloseTo(1 / 3); // only P1->P3 is two or more levels low
  });

  it("handles empty or one-sided inputs without NaN", () => {
    expect(accuracy([])).toBe(0);
    expect(p1Recall([{ expected: "P3", predicted: "P3" }])).toBe(0);
    expect(coherenceDetection([]).recall).toBe(0);
  });

  it("safety rate flags medical-advice language", () => {
    expect(safetyRate(["Rules: people trapped; requires rescuer validation.", "Apply pressure to the wound", "Aplique un torniquete"])).toBeCloseTo(1 / 3);
  });

  it("coherence detection separates jokes from normal reports", () => {
    const r = coherenceDetection([
      { expectedLow: true, coherence: 0.1 },
      { expectedLow: true, coherence: 0.9 },
      { expectedLow: false, coherence: 0.85 },
      { expectedLow: false, coherence: 0.2 },
    ]);
    expect(r.recall).toBeCloseTo(0.5);
    expect(r.falsePositiveRate).toBeCloseTo(0.5);
  });
});

describe("dataset hygiene", () => {
  it("has unique ids, valid labels and a realistic spread", () => {
    expect(new Set(DATASET.map((d) => d.id)).size).toBe(DATASET.length);
    expect(DATASET.length).toBeGreaterThanOrEqual(60);
    const count = (p: string) => DATASET.filter((d) => d.expectedPriority === p).length;
    for (const p of ["P1", "P2", "P3", "P4"]) expect(count(p)).toBeGreaterThanOrEqual(5);
    expect(DATASET.some((d) => d.tags.includes("en"))).toBe(true);
    expect(DATASET.some((d) => d.tags.includes("es"))).toBe(true);
    expect(DATASET.filter((d) => d.expectedLowCoherence).length).toBeGreaterThanOrEqual(4);
  });
});

describe("level 3 rules engine on the human-labeled dataset", () => {
  it("reaches >= 0.75 exact accuracy, >= 0.9 P1 recall and never gives medical advice", async () => {
    const r = await evaluateMode("rules");
    expect(r.degraded).toBe(0);
    expect(r.accuracy).toBeGreaterThanOrEqual(0.75);
    expect(r.p1Recall).toBeGreaterThanOrEqual(0.9);
    expect(r.safety).toBe(1);
  });

  it("the deterministic mock stays at least as good as the rules baseline on P1 recall", async () => {
    const rules = await evaluateMode("rules");
    const mock = await evaluateMode("mock");
    expect(mock.p1Recall).toBeGreaterThanOrEqual(rules.p1Recall - 0.05);
    expect(mock.safety).toBe(1);
  });
});
