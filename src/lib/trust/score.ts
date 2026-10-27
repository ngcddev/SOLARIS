import type { Case, EarthquakeEvent, TrustBreakdown, TrustSignal } from "../domain/types";
import { haversineM } from "../geo/geo";

export interface TrustContext {
  now: number;
  events: EarthquakeEvent[];
  /** All other known cases (corroboration). */
  others: Case[];
  /** Position of a mesh node by id, when known (relay proximity). */
  nodePosition?: (nodeId: string) => { lat: number; lon: number } | undefined;
  revoked?: boolean;
  /** Radio range assumed for Bluetooth hops, in metres. */
  bleRangeM?: number;
}

export const LOW_CONFIDENCE_THRESHOLD = 45;

const W = { signature: 0.15, seismic: 0.25, corroboration: 0.2, relay_proximity: 0.15, coherence: 0.25 };

/**
 * Anti-false-SOS confidence score with a visible breakdown.
 * A low score only demotes priority and flags human review; nothing is ever discarded automatically.
 */
export function computeTrust(c: Case, ctx: TrustContext): TrustBreakdown {
  const signals: TrustSignal[] = [];
  const bleRange = ctx.bleRangeM ?? 50;

  // 1. Signature / identity
  signals.push({
    id: "signature",
    label: "Signature and identity",
    weight: W.signature,
    value: ctx.revoked ? 0 : 1,
    detail: ctx.revoked ? "Revoked identity" : "Valid Ed25519 signature, identity not revoked",
  });

  // 2. Active seismic event nearby in time and space
  let seismic = 0.4;
  let seismicDetail = "No active seismic event on record";
  const ev = ctx.events
    .map((e) => ({ e, km: haversineM(e.lat, e.lon, c.lat, c.lon) / 1000, hrs: (c.sentAt - e.time) / 3_600_000 }))
    .filter((x) => x.hrs >= -0.1 && x.hrs <= 72)
    .sort((a, b) => a.km - b.km)[0];
  if (ev) {
    const spatial = ev.km <= 30 ? 1 : ev.km <= 100 ? 0.7 : ev.km <= 250 ? 0.35 : 0.05;
    const temporal = ev.hrs <= 24 ? 1 : 0.8;
    seismic = spatial * temporal;
    seismicDetail = `Evento M${ev.e.magnitude.toFixed(1)} a ${ev.km.toFixed(0)} km, hace ${Math.max(0, ev.hrs).toFixed(1)} h${ev.e.simulated ? " (simulado)" : ""}`;
  }
  signals.push({ id: "seismic", label: "Active seismic event", weight: W.seismic, value: seismic, detail: seismicDetail });

  // 3. Corroboration by other reports from other identities
  const near = ctx.others.filter(
    (o) => o.id !== c.id && o.senderKey !== c.senderKey && haversineM(o.lat, o.lon, c.lat, c.lon) <= 400,
  ).length;
  signals.push({
    id: "corroboration",
    label: "Nearby SOS from others",
    weight: W.corroboration,
    value: near === 0 ? 0.3 : near === 1 ? 0.65 : 1,
    detail: near === 0 ? "No other reports within 400 m" : `${near} report(s) from other people within 400 m`,
  });

  // 4. Relay proximity: the first Bluetooth hop must be within radio range of the reported position
  let relay = 0.5;
  let relayDetail = "No relay node data";
  const first = c.paths.map((p) => p[0]).filter(Boolean).map((id) => ctx.nodePosition?.(id)).filter(Boolean)[0];
  if (first) {
    const d = haversineM(first.lat, first.lon, c.lat, c.lon);
    relay = d <= bleRange * 1.2 ? 1 : d <= bleRange * 3 ? 0.55 : 0.05;
    relayDetail = `First node ${d.toFixed(0)} m from the reported location (Bluetooth range ~${bleRange} m)`;
  }
  signals.push({ id: "relay_proximity", label: "Node proximity", weight: W.relay_proximity, value: relay, detail: relayDetail });

  // 5. Content coherence according to triage
  const coh = c.triage?.coherence ?? 0.6;
  signals.push({
    id: "coherence",
    label: "Content coherence",
    weight: W.coherence,
    value: coh,
    detail: c.triage ? (coh < 0.4 ? "Contradictory or non-serious content" : "Content consistent with the emergency type") : "Triage pending",
  });

  let score = signals.reduce((s, x) => s + x.value * x.weight, 0) * 100;

  // 6. Field photo evidence (brigadista/drone) adds, never subtracts
  const personFound = c.photos.some((p) => p.findings.some((f) => /person/i.test(f.phrase) && f.count > 0));
  if (personFound) {
    score += 10;
    signals.push({ id: "field_photo", label: "Field photo", weight: 0, value: 1, detail: "Rescuer photo confirms people at the site (+10)" });
  }

  score = Math.round(Math.max(0, Math.min(100, score)));
  return { score, signals, lowConfidence: score < LOW_CONFIDENCE_THRESHOLD };
}
