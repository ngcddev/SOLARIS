import type { AiMode } from "../ai/types";
import { MODE_LABEL, runAnalyst, runTranscription, runTriage, runVision, selectMode, type RunOptions } from "../ai/orchestrator";
import { ingestConfig } from "../config";
import type { Case, CaseStatus, EarthquakeEvent, Team } from "../domain/types";
import { ingest, type IngestResult } from "../ingest/pipeline";
import { fromBase64, toBase64 } from "../packet";
import { applyTrustToPriority, isActive } from "../priority/queue";
import { getRepository } from "../repo/memory";
import { computeTrust } from "../trust/score";
import { fetchUsgsEvents } from "../geo/geo";
import { getCenterKeys } from "./center";
import { DEFAULT_TEAMS, getRuntime } from "./runtime";

/** Application service used by the API routes and the scenario script. */

const CODEC2_BPS = 1200; // theoretical Codec2 bitrate; real Codec2 is out of scope (docs/ASSUMPTIONS.md)
const PHOTO_PHRASES = ["person", "collapsed structure", "blocked road"];

export function currentMode(): AiMode {
  return selectMode(getRuntime().offline);
}

function runOptions(): RunOptions {
  const rt = getRuntime();
  return {
    mode: currentMode(),
    onDegrade: (stage, reason) => {
      rt.degradations.push({ at: Date.now(), stage, reason });
      rt.degradations = rt.degradations.slice(-20);
    },
  };
}

export async function ensureSeeded() {
  const rt = getRuntime();
  if (rt.seeded) return;
  rt.seeded = true;
  const repo = getRepository();
  for (const t of DEFAULT_TEAMS) await repo.saveTeam({ ...t });
  if (process.env.USGS_FEED_ENABLED === "true") {
    const real = await fetchUsgsEvents();
    if (real.length) await repo.setEvents(real);
  }
}

export interface ProcessResult {
  status: IngestResult["status"];
  reason?: string;
  id?: string;
  kind?: "sos" | "audio";
}

export async function processPacket(packetB64: string, path: string[] = [], now = Date.now()): Promise<ProcessResult> {
  await ensureSeeded();
  const repo = getRepository();
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(packetB64);
  } catch {
    await repo.bumpMetric("received");
    await repo.bumpMetric("rejected");
    await repo.logRejection({ at: now, reason: "malformed" });
    return { status: "rejected", reason: "malformed" };
  }
  const res = await ingest({ packet: bytes, path }, { repo, center: await getCenterKeys(), config: ingestConfig(), now });
  if (res.status === "rejected") return { status: "rejected", reason: res.reason, id: res.id };
  if (res.status === "duplicate") {
    await refreshTrust(now);
    return { status: "duplicate", id: res.id };
  }
  if (res.kind === "sos") {
    await analyzeCase(res.case.id, now);
    return { status: "accepted", id: res.case.id, kind: "sos" };
  }
  if (res.audio) await attachAudio(res.parentId, res.audio, now);
  return { status: "accepted", id: res.parentId, kind: "audio" };
}

async function attachAudio(caseId: string, audio: Uint8Array, now: number) {
  const rt = getRuntime();
  const repo = getRepository();
  const c = await repo.getCase(caseId);
  if (!c) {
    rt.pendingAudio.set(caseId, audio);
    return;
  }
  rt.audioStore.set(caseId, audio);
  await analyzeCase(caseId, now);
}

/** Triage + trust + priority for one case (re-run when audio arrives). */
export async function analyzeCase(caseId: string, now = Date.now()) {
  const repo = getRepository();
  const rt = getRuntime();
  const c = await repo.getCase(caseId);
  if (!c) return;

  const pending = rt.pendingAudio.get(caseId);
  if (pending) {
    rt.audioStore.set(caseId, pending);
    rt.pendingAudio.delete(caseId);
  }
  const audio = rt.audioStore.get(caseId);
  const opts = runOptions();

  if (audio && !c.transcript) {
    const tr = await runTranscription({ audio }, opts);
    c.transcript = { text: tr.text, source: tr.source };
    const isWav = audio.length > 44 && audio[0] === 0x52;
    const seconds = isWav ? Math.round((audio.length - 44) / 32000) : Math.max(3, Math.round(tr.text.length / 14));
    c.audio = { bytes: audio.length, seconds, codec2TheoreticalBytes: Math.ceil((seconds * CODEC2_BPS) / 8) };
    c.events.push({ at: now, kind: "audio", note: `Audio received (${seconds} s)` });
  }

  const hadTriage = !!c.triage;
  const triage = await runTriage(
    {
      type: c.type,
      who: c.who,
      count: c.count,
      lat: c.lat,
      lon: c.lon,
      waitMinutes: Math.max(0, (now - c.sentAt) / 60000),
      transcript: c.transcript?.text,
    },
    opts,
  );
  c.triage = triage;
  c.triagedAt = now;
  c.events.push({ at: now, kind: hadTriage ? "retriaged" : "triaged", note: `Triage ${triage.priority} (${triage.source === "rules" ? "rules" : triage.source === "mock" ? "simulated" : "Meta"})` });
  await repo.saveCase(c);
  await refreshTrust(now);
}

/** Corroboration depends on the other cases, so every case is re-scored when the set changes. */
export async function refreshTrust(now = Date.now()) {
  const repo = getRepository();
  const rt = getRuntime();
  const [cases, events] = await Promise.all([repo.listCases(), repo.getEvents()]);
  for (const c of cases) {
    if (!c.triage) continue;
    const revoked = await repo.isRevoked(c.senderKey);
    c.trust = computeTrust(c, {
      now,
      events,
      others: cases,
      revoked,
      nodePosition: (id) => rt.nodes.get(id),
    });
    const { priority, needsReview } = applyTrustToPriority(c.triage.priority, c.trust.lowConfidence);
    c.priority = priority;
    c.needsReview = needsReview || c.needsReview;
    await repo.saveCase(c);
  }
}

export async function getState() {
  await ensureSeeded();
  const repo = getRepository();
  const rt = getRuntime();
  const [cases, teams, metrics, rejections, events] = await Promise.all([
    repo.listCases(),
    repo.listTeams(),
    repo.getMetrics(),
    repo.listRejections(),
    repo.getEvents(),
  ]);
  const triaged = cases.filter((c) => c.triage);
  const avgTriageMs = triaged.length ? triaged.reduce((s, c) => s + (c.triage?.latencyMs ?? 0), 0) / triaged.length : 0;
  const mode = currentMode();
  return {
    now: Date.now(),
    mode,
    modeLabel: MODE_LABEL[mode],
    offline: rt.offline,
    // Photos are heavy: the list carries findings only; the image itself comes from GET /api/cases/[id].
    cases: cases.map((c) => ({ ...c, photos: c.photos.map((p) => ({ ...p, dataUrl: "" })) })),
    teams,
    events,
    nodes: [...rt.nodes.entries()].map(([id, p]) => ({ id, ...p })),
    metrics: { ...metrics, prioritized: triaged.length, avgTriageMs: Math.round(avgTriageMs * 10) / 10 },
    rejections: rejections.slice(-30).reverse(),
    degradations: rt.degradations.slice(-5),
    centerPublicKey: toBase64((await getCenterKeys()).publicKey),
  };
}

export function setOffline(offline: boolean) {
  getRuntime().offline = offline;
}

export type CaseAction = "validate" | "false" | "assign" | "dispatch" | "close";

export async function applyAction(caseId: string, action: CaseAction, teamId?: string, now = Date.now()): Promise<{ ok: boolean; error?: string }> {
  const repo = getRepository();
  const c = await repo.getCase(caseId);
  if (!c) return { ok: false, error: "Case not found" };
  const setStatus = (status: CaseStatus, kind: Case["events"][number]["kind"], note: string) => {
    c.status = status;
    c.events.push({ at: now, kind, note });
  };
  const freeTeam = async (): Promise<Team | undefined> => (c.assignedTeamId ? (await repo.listTeams()).find((t) => t.id === c.assignedTeamId) : undefined);

  switch (action) {
    case "validate":
      setStatus("validated", "validated", "Validated by the rescuer");
      c.needsReview = false;
      break;
    case "false":
      setStatus("false", "marked_false", "Marked as false by the rescuer");
      break;
    case "assign": {
      const team = (await repo.listTeams()).find((t) => t.id === teamId);
      if (!team) return { ok: false, error: "Team not found" };
      if (team.status !== "available") return { ok: false, error: "Team is not available" };
      const prev = await freeTeam();
      if (prev) await repo.saveTeam({ ...prev, status: "available" });
      await repo.saveTeam({ ...team, status: "assigned" });
      c.assignedTeamId = team.id;
      setStatus("assigned", "assigned", `Assigned to ${team.name}`);
      break;
    }
    case "dispatch": {
      const team = await freeTeam();
      if (!team) return { ok: false, error: "Assign a team first" };
      await repo.saveTeam({ ...team, status: "dispatched" });
      setStatus("dispatched", "dispatched", `${team.name} dispatched`);
      break;
    }
    case "close": {
      const team = await freeTeam();
      if (team) await repo.saveTeam({ ...team, status: "available" });
      setStatus("closed", "closed", "Case closed");
      break;
    }
  }
  await repo.saveCase(c);
  return { ok: true };
}

export async function recommendAssignments(now = Date.now()) {
  await ensureSeeded();
  const repo = getRepository();
  const [cases, teams] = await Promise.all([repo.listCases(), repo.listTeams()]);
  const candidates = cases.filter((c) => isActive(c) && c.triage && c.status !== "assigned" && c.status !== "dispatched");
  const input = {
    cases: candidates.map((c) => ({
      id: c.id,
      priority: c.priority,
      trust: c.trust?.score ?? 0,
      people: c.triage!.people,
      type: c.type,
      trapped: c.triage!.trapped,
      lat: Math.round(c.lat * 1e4) / 1e4,
      lon: Math.round(c.lon * 1e4) / 1e4,
      waitMinutes: Math.round((now - c.sentAt) / 60000),
      justification: c.triage!.justification,
    })),
    teams,
  };
  const out = await runAnalyst(input, runOptions());
  return { ...out, mode: currentMode(), modeLabel: MODE_LABEL[currentMode()] };
}

export async function addFieldPhoto(caseId: string, dataUrl: string, now = Date.now()): Promise<{ ok: boolean; error?: string }> {
  const repo = getRepository();
  const c = await repo.getCase(caseId);
  if (!c) return { ok: false, error: "Case not found" };
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl) || dataUrl.length > 6_000_000) return { ok: false, error: "Invalid or too large image" };
  const { findings, source } = await runVision({ imageDataUrl: dataUrl, phrases: PHOTO_PHRASES }, runOptions());
  c.photos.push({ id: `ph-${c.photos.length + 1}`, uploadedAt: now, dataUrl, findings, source });
  c.events.push({ at: now, kind: "photo", note: source === "rules" ? "Field photo uploaded (no analysis: rules mode)" : `Field photo analyzed (${findings.map((f) => `${f.phrase}: ${f.count}`).join(", ")})` });
  await repo.saveCase(c);
  await refreshTrust(now);
  return { ok: true };
}

export async function setEvents(events: EarthquakeEvent[]) {
  await getRepository().setEvents(events);
}
