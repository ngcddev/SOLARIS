/**
 * Runs the Cali 2026 demo scenario in-process (no server, no credentials) and prints a summary + benchmark.
 *   npm run scenario
 */
import { getState } from "../src/lib/server/service";
import { MANUAL_MINUTES_PER_SOS, loadCaliScenario, runBenchmark } from "../src/lib/server/scenarioRunner";
import { initCrypto } from "../src/lib/packet";

async function main() {
  await initCrypto();
  console.log("Escenario: sismo SIMULADO en Cali, 2026 (datos ficticios)\n");
  const run = await loadCaliScenario();
  const state = await getState();
  console.log(`Evento: ${run.eventPlace}`);
  console.log(`Modo de IA: ${state.modeLabel}`);
  console.log(`Llegadas al centro: ${run.deliveries} (${run.validSos} SOS válidos + duplicados por varios caminos + ataques)`);
  console.log(`  aceptados: ${run.outcome.accepted}, duplicados fusionados: ${run.outcome.duplicates}`);
  console.log(`  rechazados: ${JSON.stringify(run.outcome.rejectedByReason)}`);
  const lows = state.cases.filter((c) => c.needsReview);
  console.log(`  casos con baja confianza (revisión humana, no descartados): ${lows.length}`);
  const byP = { P1: 0, P2: 0, P3: 0, P4: 0 } as Record<string, number>;
  state.cases.forEach((c) => byP[c.priority]++);
  console.log(`  prioridades: ${JSON.stringify(byP)}`);
  console.log(`  procesado en ${run.elapsedMs} ms\n`);

  const b = await runBenchmark(100);
  console.log(`Benchmark (${b.mode}): ${b.count} SOS priorizados en ${b.totalMs} ms (${b.perSosMs} ms/SOS)`);
  console.log(`Revisión manual estimada (${MANUAL_MINUTES_PER_SOS} min por SOS): ${b.manualMinutes} min -> ~${b.speedup.toLocaleString("es-CO")}x más rápido`);
  console.log("La IA solo propone; la validación y el despacho siempre los decide una persona.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
