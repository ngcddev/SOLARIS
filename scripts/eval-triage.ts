/**
 * Triage evaluation: runs the labeled dataset (eval/dataset.ts) through every available AI level
 * and reports accuracy, P1 recall, within-one-level accuracy, latency, safety and coherence detection.
 *   npm run eval
 * "rules" and "mock" always run. "meta" runs only with META_API_KEY, "local" only with LOCAL_LLM_URL.
 */
import fs from "node:fs";
import path from "node:path";
import { DATASET } from "../eval/dataset";
import { runTriage } from "../src/lib/ai/orchestrator";
import type { AiMode } from "../src/lib/ai/types";
import type { Priority } from "../src/lib/domain/types";
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

export interface ModeResult {
  mode: AiMode;
  cases: number;
  accuracy: number;
  p1Recall: number;
  withinOne: number;
  severeUnderTriage: number;
  safety: number;
  coherenceRecall: number;
  coherenceFalsePositive: number;
  avgLatencyMs: number;
  /** Cases where the requested level failed and the system fell back to rules (results then mix levels). */
  degraded: number;
  perPriority: ReturnType<typeof perPriority>;
  confusion: ReturnType<typeof confusionMatrix>;
  misses: { id: string; expected: Priority; predicted: Priority; tags: string[] }[];
}

export async function evaluateMode(mode: AiMode): Promise<ModeResult> {
  const pairs: Pair[] = [];
  const texts: string[] = [];
  const coherence: { expectedLow: boolean; coherence: number }[] = [];
  const misses: ModeResult["misses"] = [];
  let latency = 0;
  let degraded = 0;
  for (const item of DATASET) {
    const t = await runTriage(item.input, { mode });
    if (t.source !== mode) degraded++;
    latency += t.latencyMs;
    pairs.push({ expected: item.expectedPriority, predicted: t.priority });
    texts.push(t.justification);
    coherence.push({ expectedLow: !!item.expectedLowCoherence, coherence: t.coherence });
    if (t.priority !== item.expectedPriority) misses.push({ id: item.id, expected: item.expectedPriority, predicted: t.priority, tags: item.tags });
  }
  const coh = coherenceDetection(coherence);
  return {
    mode,
    cases: DATASET.length,
    accuracy: accuracy(pairs),
    p1Recall: p1Recall(pairs),
    withinOne: withinOneAccuracy(pairs),
    severeUnderTriage: severeUnderTriageRate(pairs),
    safety: safetyRate(texts),
    coherenceRecall: coh.recall,
    coherenceFalsePositive: coh.falsePositiveRate,
    avgLatencyMs: Math.round((latency / DATASET.length) * 10) / 10,
    degraded,
    perPriority: perPriority(pairs),
    confusion: confusionMatrix(pairs),
    misses,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const modes: AiMode[] = ["rules", "mock"];
  if (process.env.LOCAL_LLM_URL) modes.push("local");
  if (process.env.META_API_KEY || process.env.MODEL_API_KEY) modes.push("meta");
  else console.log("Skipping the Meta API level: set META_API_KEY to evaluate Muse Spark.\n");
  if (!process.env.LOCAL_LLM_URL) console.log("Skipping the local Llama level: set LOCAL_LLM_URL to evaluate it.\n");

  const results: ModeResult[] = [];
  for (const m of modes) results.push(await evaluateMode(m));

  console.log(`Dataset: ${DATASET.length} human-labeled cases (rubric in docs/EVALUATION.md)\n`);
  console.log("mode   | exact acc | P1 recall | within-1 | severe under-triage | safety | joke recall | avg latency | degraded");
  console.log("-------|-----------|-----------|----------|---------------------|--------|-------------|-------------|---------");
  for (const r of results) {
    console.log(
      `${r.mode.padEnd(6)} | ${pct(r.accuracy).padStart(9)} | ${pct(r.p1Recall).padStart(9)} | ${pct(r.withinOne).padStart(8)} | ${pct(r.severeUnderTriage).padStart(19)} | ${pct(r.safety).padStart(6)} | ${pct(r.coherenceRecall).padStart(11)} | ${`${r.avgLatencyMs} ms`.padStart(11)} | ${r.degraded}`,
    );
  }
  for (const r of results) {
    console.log(`\n[${r.mode}] misses (${r.misses.length}): ${r.misses.map((x) => `${x.id} ${x.expected}->${x.predicted}`).join(", ") || "none"}`);
  }

  const out = path.join(__dirname, "..", "eval", "results.json");
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), dataset: DATASET.length, results }, null, 2) + "\n");
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
}

// Run only when executed directly (the tests import evaluateMode).
if (process.argv[1] && /eval-triage\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
