import type { AiSource, PhotoFinding, Triage } from "../domain/types";
import { greedyAssignment } from "../priority/queue";
import { EMERGENCY_KEYWORDS, metaConfig, type MetaConfig } from "./config";
import { metaProviders } from "./meta";
import { mockProviders } from "./mock";
import { triageByRules } from "./rules";
import { analystOutputSchema, photoFindingsSchema, triageOutputSchema } from "./schemas";
import { containsMedicalAdvice, SAFE_FALLBACK_JUSTIFICATION } from "./safety";
import type { AiMode, AnalystInput, AnalystOutput, ProviderSet, TranscriptionInput, TriageInput, VisionInput } from "./types";

/** Which level is active: forced rules (internet down), Meta API (key present) or simulated (no key). */
export function selectMode(offline: boolean, cfg: MetaConfig = metaConfig()): AiMode {
  if (offline) return "rules";
  return cfg.apiKey ? "meta" : "mock";
}

export function providersFor(mode: AiMode, cfg: MetaConfig = metaConfig()): ProviderSet | null {
  if (mode === "meta") return metaProviders(cfg);
  if (mode === "mock") return mockProviders;
  return null;
}

export const MODE_LABEL: Record<AiMode, string> = {
  meta: "AI: META API",
  mock: "AI: SIMULATED",
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

/** Triage with graceful degradation: any failure or invalid output -> level-3 rules. */
export async function runTriage(input: TriageInput, o: RunOptions): Promise<Triage> {
  const started = Date.now();
  const providers = o.providers ?? providersFor(o.mode);
  if (providers && o.mode !== "rules") {
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
  const providers = o.providers ?? providersFor(o.mode);
  if (providers && o.mode !== "rules") {
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
  const providers = o.providers ?? providersFor(o.mode);
  if (providers && o.mode !== "rules") {
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

export async function runVision(input: VisionInput, o: RunOptions): Promise<{ findings: PhotoFinding[]; source: AiSource }> {
  const providers = o.providers ?? providersFor(o.mode);
  if (providers && o.mode !== "rules") {
    try {
      const findings = photoFindingsSchema.parse(await providers.vision.segment(input));
      return { findings, source: sourceOf(providers) };
    } catch (e) {
      o.onDegrade?.("vision", errMsg(e));
    }
  }
  return { findings: [], source: "rules" }; // image analysis needs a model; nothing is invented in rules mode
}
