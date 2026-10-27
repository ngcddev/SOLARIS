import type { Priority } from "../domain/types";
import { PRIORITIES } from "../domain/types";
import { containsMedicalAdvice } from "../ai/safety";

/** Pure evaluation metrics for triage quality. No I/O, no model calls. */

export interface Pair {
  expected: Priority;
  predicted: Priority;
}

export type ConfusionMatrix = Record<Priority, Record<Priority, number>>;

const rank = (p: Priority) => PRIORITIES.indexOf(p);

/** matrix[expected][predicted] = number of cases. */
export function confusionMatrix(pairs: Pair[]): ConfusionMatrix {
  const m = Object.fromEntries(PRIORITIES.map((e) => [e, Object.fromEntries(PRIORITIES.map((p) => [p, 0]))])) as ConfusionMatrix;
  for (const { expected, predicted } of pairs) m[expected][predicted]++;
  return m;
}

const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den);

export function accuracy(pairs: Pair[]): number {
  return ratio(pairs.filter((p) => p.expected === p.predicted).length, pairs.length);
}

/** Share of cases predicted at most one priority level away from the label. */
export function withinOneAccuracy(pairs: Pair[]): number {
  return ratio(pairs.filter((p) => Math.abs(rank(p.expected) - rank(p.predicted)) <= 1).length, pairs.length);
}

export interface PriorityStats {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export function perPriority(pairs: Pair[]): Record<Priority, PriorityStats> {
  const out = {} as Record<Priority, PriorityStats>;
  for (const p of PRIORITIES) {
    const tp = pairs.filter((x) => x.expected === p && x.predicted === p).length;
    const predicted = pairs.filter((x) => x.predicted === p).length;
    const support = pairs.filter((x) => x.expected === p).length;
    const precision = ratio(tp, predicted);
    const recall = ratio(tp, support);
    out[p] = { precision, recall, f1: ratio(2 * precision * recall, precision + recall), support };
  }
  return out;
}

/** Recall on critical cases: how many truly critical SOS were ranked P1. The metric that matters most. */
export function p1Recall(pairs: Pair[]): number {
  return perPriority(pairs).P1.recall;
}

/**
 * Safety-critical error rate: critical (P1) cases ranked two or more levels too low (P3/P4).
 * Under-prioritizing a critical case is the costly mistake; over-prioritizing only costs rescuer time.
 */
export function severeUnderTriageRate(pairs: Pair[]): number {
  const critical = pairs.filter((p) => p.expected === "P1");
  return ratio(critical.filter((p) => rank(p.predicted) - rank(p.expected) >= 2).length, critical.length);
}

/** Share of generated texts that contain NO medical-advice language (target: 1.0). */
export function safetyRate(texts: string[]): number {
  return ratio(texts.filter((t) => !containsMedicalAdvice(t)).length, texts.length);
}

export interface CoherenceSample {
  expectedLow: boolean;
  coherence: number;
}

/** Detection of jokes / contradictory reports (coherence below the threshold counts as "low"). */
export function coherenceDetection(samples: CoherenceSample[], threshold = 0.4) {
  const positives = samples.filter((s) => s.expectedLow);
  const negatives = samples.filter((s) => !s.expectedLow);
  return {
    recall: ratio(positives.filter((s) => s.coherence < threshold).length, positives.length),
    falsePositiveRate: ratio(negatives.filter((s) => s.coherence < threshold).length, negatives.length),
    support: positives.length,
  };
}
