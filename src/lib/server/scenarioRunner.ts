import { MemoryRepository, getRepository } from "../repo/memory";
import { buildCaliScenario } from "../scenario/cali2026";
import {
  buildSosPacket,
  generateIdentity,
  toBase64,
  buildAudioPacket,
  randomBytes,
} from "../packet";
import { SIMULATED_AUDIO_PREFIX } from "../ai/mock";
import { getCenterKeys } from "./center";
import { DEFAULT_TEAMS, getRuntime, resetRuntime, type Runtime } from "./runtime";
import { currentMode, ensureSeeded, getState, processPacket, setEvents } from "./service";
import type { Repository } from "../repo/Repository";
import { mulberry32, offsetM } from "../mesh/graph";

/** Estimated minutes a human needs to read, locate and rank one SOS by hand (assumption, see docs/ASSUMPTIONS.md). */
export const MANUAL_MINUTES_PER_SOS = 2;

export interface ScenarioRunSummary {
  eventPlace: string;
  validSos: number;
  deliveries: number;
  attacks: Record<string, number>;
  outcome: { accepted: number; duplicates: number; rejectedByReason: Record<string, number> };
  elapsedMs: number;
}

/** Loads the Cali 2026 demo into the live state (resets everything first). */
export async function loadCaliScenario(now = Date.now()): Promise<ScenarioRunSummary> {
  const repo = getRepository();
  await repo.reset();
  resetRuntime();
  await ensureSeeded();
  const center = await getCenterKeys();
  const sc = await buildCaliScenario({ centerPublicKey: center.publicKey, now });
  const rt = getRuntime();
  for (const n of sc.nodes) rt.nodes.set(n.id, { lat: n.lat, lon: n.lon, kind: n.kind });
  await setEvents([sc.event]);
  for (const k of sc.revoked) await repo.revoke(k);

  const started = performance.now();
  const rejectedByReason: Record<string, number> = {};
  let accepted = 0;
  let duplicates = 0;
  for (const d of sc.deliveries) {
    const res = await processPacket(d.packetB64, d.path, d.at);
    if (res.status === "accepted" && res.kind === "sos") accepted++;
    else if (res.status === "duplicate") duplicates++;
    else if (res.status === "rejected") rejectedByReason[res.reason ?? "unknown"] = (rejectedByReason[res.reason ?? "unknown"] ?? 0) + 1;
  }
  return {
    eventPlace: sc.event.place,
    validSos: sc.stats.validSos,
    deliveries: sc.deliveries.length,
    attacks: sc.stats.attacks,
    outcome: { accepted, duplicates, rejectedByReason },
    elapsedMs: Math.round(performance.now() - started),
  };
}

export interface BenchmarkResult {
  count: number;
  mode: string;
  totalMs: number;
  perSosMs: number;
  manualMinutes: number;
  speedup: number;
}

const g = globalThis as unknown as { __solarisRepo?: Repository; __solarisRuntime?: Runtime };

/** Times the full pipeline (verify, decrypt, triage, trust, queue) for N fresh SOS in an isolated state. */
export async function runBenchmark(n = 100): Promise<BenchmarkResult> {
  const savedRepo = g.__solarisRepo;
  const savedRuntime = g.__solarisRuntime;
  const savedOffline = savedRuntime?.offline ?? false;
  g.__solarisRepo = new MemoryRepository();
  g.__solarisRuntime = undefined;
  getRuntime().offline = savedOffline; // benchmark the mode that is currently active
  try {
    const repo = getRepository();
    for (const t of DEFAULT_TEAMS) await repo.saveTeam({ ...t });
    getRuntime().seeded = true;
    const center = await getCenterKeys();
    const r = mulberry32(99);
    const now = Date.now();
    const types = ["trapped", "injured", "bleeding", "fire", "other"] as const;
    const texts = ["estamos atrapados bajo los escombros, hay un bebé", "hay un herido, la casa se cayó", "mucha sangre, necesitamos ayuda", "se quema la casa de al lado, hay humo", "el edificio se agrietó"];
    const packets: { b64: string[] }[] = [];
    for (let i = 0; i < n; i++) {
      const identity = await generateIdentity();
      const [lat, lon] = offsetM(3.4516, -76.532, (r() - 0.5) * 4000, (r() - 0.5) * 4000);
      const ti = Math.floor(r() * types.length);
      const msgId = randomBytes(16);
      const opts = { identity, centerPublicKey: center.publicKey, timestamp: Math.floor(now / 1000) };
      const sos = buildSosPacket({ type: types[ti], who: r() < 0.3 ? ["adult", "baby"] : ["adult"], count: 1 + Math.floor(r() * 5), lat, lon }, { ...opts, msgId });
      const parts = [toBase64(sos)];
      if (r() < 0.5) parts.push(toBase64(buildAudioPacket({ parentId: msgId, index: 0, total: 1, data: new TextEncoder().encode(SIMULATED_AUDIO_PREFIX + texts[ti]) }, opts)));
      packets.push({ b64: parts });
    }
    const started = performance.now();
    for (const p of packets) for (const b64 of p.b64) await processPacket(b64, ["bench", "gw-1"], now);
    const totalMs = performance.now() - started;
    const state = await getState();
    const manualMinutes = n * MANUAL_MINUTES_PER_SOS;
    return {
      count: state.cases.length,
      mode: currentMode(),
      totalMs: Math.round(totalMs),
      perSosMs: Math.round((totalMs / n) * 10) / 10,
      manualMinutes,
      speedup: Math.round((manualMinutes * 60_000) / Math.max(1, totalMs)),
    };
  } finally {
    g.__solarisRepo = savedRepo;
    g.__solarisRuntime = savedRuntime;
  }
}
