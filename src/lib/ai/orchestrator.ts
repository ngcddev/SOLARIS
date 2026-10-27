import type { AiSource, PhotoFinding, Triage } from "../domain/types";
import { greedyAssignment } from "../priority/queue";
import { EMERGENCY_KEYWORDS, localConfig, metaConfig, type LocalConfig, type MetaConfig } from "./config";
import { localProviders } from "./local";
import { metaProviders } from "./meta";
import { mockProviders } from "./mock";
import { crossCheckByRules, handoverByRules, type CrossCheckInput, type CrossCheckOutput, type HandoverInput, type HandoverOutput } from "./reports";
import { triageByRules } from "./rules";
import { analystOutputSchema, crossCheckOutputSchema, handoverOutputSchema, photoFindingsSchema, triageOutputSchema } from "./schemas";
import { containsMedicalAdvice, SAFE_FALLBACK_JUSTIFICATION } from "./safety";
import type { AiMode, AnalystInput, AnalystOutput, ProviderSet, TranscriptionInput, TriageInput, VisionInput } from "./types";

/**
 * Which level is active:
 *  - internet down + a local Llama configured -> level 2 ("local"),
 *  - internet down otherwise                 -> level 3 ("rules"),
 *  - online with a Meta key                  -> level 1 ("meta"),
 *  - online without a key                    -> deterministic "mock".
 */
export function selectMode(offline: boolean, cfg: MetaConfig = metaConfig(), local: LocalConfig = localConfig()): AiMode {
  if (offline) return local.url ? "local" : "rules";
  return cfg.apiKey ? "meta" : "mock";
}

export function providersFor(mode: AiMode, cfg: MetaConfig = metaConfig(), local: LocalConfig = localConfig()): ProviderSet | null {
  if (mode === "meta") return metaProviders(cfg);
  if (mode === "mock") return mockProviders;
  if (mode === "local") return localProviders(local);
  return null;
}

export const MODE_LABEL: Record<AiMode, string> = {
  meta: "AI: META API",
  mock: "AI: SIMULATED",
  local: "OFFLINE: LOCAL LLAMA",
  rules: "OFFLINE: RULES",
};

export interface RunOptions {
  mode: AiMode;
  providers?: ProviderSet | null;
  /** Called with a safe, content-free message when we degrade to rules. */
  onDegrade?: (stage: string, reason: string) => void;
}

const sourceOf = (p: ProviderSet): AiSource => p.source;
const errMsg = (e: unknown) => (e instanceof Error ? e.message.slice(0, 160) : "unknown error");
const resolve = (o: RunOptions) => (o.mode === "rules" ? null : (o.providers ?? providersFor(o.mode)));

/** Triage with graceful degradation: any failure or invalid output -> level-3 rules. */
export async function runTriage(input: TriageInput, o: RunOptions): Promise<Triage> {
  const started = Date.now();
  const providers = resolve(o);
  if (providers) {
    try {
      const parsed = triageOutputSchema.parse(await providers.triage.triage(input));
      const justification = containsMedicalAdvice(parsed.justification) ? SAFE_FALLBACK_JUSTIFICATION : parsed.justification;
      return { ...parsed, justification, source: sourceOf(providers), latencyMs: Date.now() - started };
    } catch (e) {
      o.onDegrade?.("triage", errMsg(e));
    }
  }
  return { ...triageByRules(input), source: "rules", latencyMs: Date.now() - started };
}

export async function runTranscription(input: Omit<TranscriptionInput, "keywords" | "language">, o: RunOptions): Promise<{ text: string; source: AiSource }> {
  const providers = resolve(o);
  if (providers?.transcription) {
    try {
      const { text } = await providers.transcription.transcribe({ ...input, keywords: EMERGENCY_KEYWORDS, language: "es" });
      return { text, source: sourceOf(providers) };
    } catch (e) {
      o.onDegrade?.("transcription", errMsg(e));
    }
  }
  return { text: "", source: "rules" }; // no transcript available without AI; buttons still drive triage
}

export async function runAnalyst(input: AnalystInput, o: RunOptions): Promise<AnalystOutput & { source: AiSource }> {
  const providers = resolve(o);
  if (providers?.analyst) {
    try {
      const out = analystOutputSchema.parse(await providers.analyst.recommend(input));
      const caseIds = new Set(input.cases.map((c) => c.id));
      const free = new Set(input.teams.filter((t) => t.status === "available").map((t) => t.id));
      const seenTeams = new Set<string>();
      // Drop hallucinated ids, busy teams and double bookings; keep the rest.
      const assignments = out.assignments.filter((a) => {
        if (!caseIds.has(a.caseId) || !free.has(a.teamId) || seenTeams.has(a.teamId)) return false;
        seenTeams.add(a.teamId);
        return !containsMedicalAdvice(a.rationale);
      });
      return { assignments, notes: containsMedicalAdvice(out.notes) ? "" : out.notes, source: sourceOf(providers) };
    } catch (e) {
      o.onDegrade?.("analyst", errMsg(e));
    }
  }
  return { ...greedyAssignment(input), source: "rules" };
}

/** Multimodal consistency check (Muse Wonder). Falls back to the deterministic rules version. */
export async function runCrossCheck(input: CrossCheckInput & { images?: string[] }, o: RunOptions): Promise<CrossCheckOutput & { source: AiSource }> {
  const providers = resolve(o);
  if (providers?.analyst) {
    try {
      const out = crossCheckOutputSchema.parse(await providers.analyst.crossCheck(input));
      if (out.reasons.some(containsMedicalAdvice)) throw new Error("medical language in cross-check");
      return { ...out, source: sourceOf(providers) };
    } catch (e) {
      o.onDegrade?.("cross-check", errMsg(e));
    }
  }
  return { ...crossCheckByRules(input), source: "rules" };
}

/** Long-context shift handover report (Muse Wonder). Falls back to the deterministic template. */
export async function runHandover(input: HandoverInput, o: RunOptions): Promise<HandoverOutput & { source: AiSource }> {
  const providers = resolve(o);
  if (providers?.analyst) {
    try {
      const out = handoverOutputSchema.parse(await providers.analyst.handover(input));
      const all = [out.headline, ...out.summary, ...out.risks, ...out.nextActions];
      if (all.some(containsMedicalAdvice)) throw new Error("medical language in handover");
      return { ...out, source: sourceOf(providers) };
    } catch (e) {
      o.onDegrade?.("handover", errMsg(e));
    }
  }
  return { ...handoverByRules(input), source: "rules" };
}

export async function runVision(input: VisionInput, o: RunOptions): Promise<{ findings: PhotoFinding[]; source: AiSource }> {
  const providers = resolve(o);
  if (providers?.vision) {
    try {
      const findings = photoFindingsSchema.parse(await providers.vision.segment(input));
      return { findings, source: sourceOf(providers) };
    } catch (e) {
      o.onDegrade?.("vision", errMsg(e));
    }
  }
  return { findings: [], source: "rules" }; // image analysis needs a model; nothing is invented in rules mode
}
