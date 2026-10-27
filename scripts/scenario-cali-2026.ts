/**
 * Runs the Cali 2026 demo scenario in-process (no server, no credentials) and prints a summary + benchmark.
 *   npm run scenario
 */
import { getState } from "../src/lib/server/service";
import { MANUAL_MINUTES_PER_SOS, loadCaliScenario, runBenchmark } from "../src/lib/server/scenarioRunner";
import { initCrypto } from "../src/lib/packet";

async function main() {
  await initCrypto();
  console.log("Scenario: SIMULATED earthquake in Cali, 2026 (fictional data)\n");
  const run = await loadCaliScenario();
  const state = await getState();
  console.log(`Event: ${run.eventPlace}`);
  console.log(`AI mode: ${state.modeLabel}`);
  console.log(`Arrivals at the center: ${run.deliveries} (${run.validSos} valid SOS + multi-path duplicates + attacks)`);
  console.log(`  accepted: ${run.outcome.accepted}, duplicates merged: ${run.outcome.duplicates}`);
  console.log(`  rejected: ${JSON.stringify(run.outcome.rejectedByReason)}`);
  const lows = state.cases.filter((c) => c.needsReview);
  console.log(`  low-confidence cases (human review, not discarded): ${lows.length}`);
  const byP = { P1: 0, P2: 0, P3: 0, P4: 0 } as Record<string, number>;
  state.cases.forEach((c) => byP[c.priority]++);
  console.log(`  priorities: ${JSON.stringify(byP)}`);
  console.log(`  processed in ${run.elapsedMs} ms\n`);

  const b = await runBenchmark(100);
  console.log(`Benchmark (${b.mode}): ${b.count} SOS prioritized in ${b.totalMs} ms (${b.perSosMs} ms/SOS)`);
  console.log(`Estimated manual review (${MANUAL_MINUTES_PER_SOS} min per SOS): ${b.manualMinutes} min -> ~${b.speedup.toLocaleString("en-US")}x faster`);
  console.log("The AI only proposes; validation and dispatch are always decided by a person.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
