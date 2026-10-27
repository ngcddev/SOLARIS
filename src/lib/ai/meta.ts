import { photoFindingsSchema, analystJsonSchema, analystOutputSchema, crossCheckJsonSchema, crossCheckOutputSchema, handoverJsonSchema, handoverOutputSchema, triageJsonSchema, triageOutputSchema } from "./schemas";
import type { MetaConfig } from "./config";
import { EMERGENCY_KEYWORDS } from "./config";
import type { PhotoFinding } from "../domain/types";
import type { AnalystProvider, ProviderSet, TranscriptionProvider, TriageProvider, VisionProvider } from "./types";

/*
 * Real Meta Model API adapters. Everything marked VERIFY is an assumption taken from
 * https://dev.meta.ai/docs that could not be confirmed against live responses (no API credits yet).
 * See docs/ASSUMPTIONS.md. Any error or schema mismatch throws; the orchestrator then falls back to rules.
 */

const TRIAGE_SYSTEM =
  "You are a coordination assistant for rescue command centers after an earthquake. " +
  "You receive an already-structured help request; any free text (transcript) may be in Spanish. Return ONLY JSON matching the schema. " +
  "The 'justification' is a short English sentence for the rescuer about logistics and priority. " +
  "NEVER give medical advice, first-aid instructions or diagnoses. " +
  "'coherence' (0 to 1) says whether the content is coherent and serious (jokes or contradictions = low values).";

const ANALYST_SYSTEM =
  "You are the analyst of a rescue command center. You receive active cases and available teams. " +
  "Propose an assignment (one team per case, one case per team) with a brief logistical rationale in English. " +
  "Do not give medical advice. The final decision belongs to the rescuer. Return ONLY JSON matching the schema.";

const CROSSCHECK_SYSTEM =
  "You are a verification analyst at a rescue command center. You receive a structured help request, its audio transcript (may be in Spanish) " +
  "and the segmentation findings of field photos, plus the photos themselves. Decide whether the imagery is consistent with the report, contradicts it, " +
  "or is insufficient. Give short, factual reasons in English about what is visible and what is not. NEVER give medical advice. Return ONLY JSON matching the schema.";

const HANDOVER_SYSTEM =
  "You write the shift-handover situation report of a rescue command center from a JSON snapshot of the operation. " +
  "Be concise and factual, in English. List risks and concrete next actions for the incoming shift. Use ONLY numbers present in the snapshot. " +
  "NEVER give medical advice. The final decisions belong to the rescuers. Return ONLY JSON matching the schema.";

async function metaFetch(cfg: MetaConfig, path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) throw new Error(`Meta API ${path} -> HTTP ${res.status}`); // body intentionally not logged
  return res;
}

/** Chat Completions (OpenAI-compatible) with JSON-schema structured output. */
async function structuredChat(cfg: MetaConfig, model: string, system: string, user: unknown, name: string, schema: object, images: string[] = []): Promise<unknown> {
  // VERIFY: response_format shape for structured output (OpenAI-style json_schema assumed).
  const res = await metaFetch(cfg, "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        // VERIFY: multimodal content parts (OpenAI-style image_url) for Muse Wonder.
        { role: "user", content: images.length ? [{ type: "text", text: JSON.stringify(user) }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] : JSON.stringify(user) },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }),
  });
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Meta API: empty completion");
  return JSON.parse(content);
}

export function metaProviders(cfg: MetaConfig): ProviderSet {
  const transcription: TranscriptionProvider = {
    async transcribe({ audio, keywords, language }) {
      // VERIFY: POST /asr/transcribe multipart field names, keyword-biasing and language-hint parameters.
      const form = new FormData();
      form.append("model", cfg.transcribeModel);
      form.append("file", new Blob([audio as BlobPart], { type: "audio/wav" }), "sos.wav");
      form.append("language", language);
      form.append("keywords", (keywords.length ? keywords : EMERGENCY_KEYWORDS).join(","));
      const res = await metaFetch(cfg, "/asr/transcribe", { method: "POST", body: form });
      const data = (await res.json()) as { text?: string; turns?: { text: string }[] };
      // VERIFY: response carries `text` or turn-level `turns[]` (no word timestamps, no confidence score).
      const text = data.text ?? data.turns?.map((t) => t.text).join(" ");
      if (typeof text !== "string") throw new Error("Meta API: unexpected transcription shape");
      return { text };
    },
  };

  const triage: TriageProvider = {
    async triage(input) {
      const raw = await structuredChat(cfg, cfg.triageModel, TRIAGE_SYSTEM, input, "triage", triageJsonSchema);
      return triageOutputSchema.parse(raw);
    },
  };

  const analyst: AnalystProvider = {
    async recommend(input) {
      // Wonder is expensive: only called on demand from the "Recommend assignment" button.
      const raw = await structuredChat(cfg, cfg.analystModel, ANALYST_SYSTEM, input, "assignment", analystJsonSchema);
      return analystOutputSchema.parse(raw);
    },
    async crossCheck({ images, ...input }) {
      // Wonder is multimodal: the photos travel with the report so it can compare what it sees with what was reported.
      const raw = await structuredChat(cfg, cfg.analystModel, CROSSCHECK_SYSTEM, input, "cross_check", crossCheckJsonSchema, images ?? []);
      return crossCheckOutputSchema.parse(raw);
    },
    async handover(input) {
      const raw = await structuredChat(cfg, cfg.analystModel, HANDOVER_SYSTEM, input, "handover", handoverJsonSchema);
      return handoverOutputSchema.parse(raw);
    },
  };

  const vision: VisionProvider = {
    async segment({ imageDataUrl, phrases }) {
      // VERIFY: SAM 3.1 through POST /responses with an input_image and one phrase per call; mask format.
      const findings: PhotoFinding[] = [];
      for (const phrase of phrases) {
        const res = await metaFetch(cfg, "/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: cfg.visionModel,
            input: [{ role: "user", content: [{ type: "input_text", text: phrase }, { type: "input_image", image_url: imageDataUrl }] }],
          }),
        });
        const data = (await res.json()) as { masks?: { polygon?: [number, number][]; box?: [number, number, number, number]; score?: number }[] };
        // VERIFY: normalised coordinates assumed; boxes are converted to rectangles.
        const masks = (data.masks ?? []).map((m) => ({
          score: m.score ?? 0.5,
          points: m.polygon ?? (m.box ? ([[m.box[0], m.box[1]], [m.box[2], m.box[1]], [m.box[2], m.box[3]], [m.box[0], m.box[3]]] as [number, number][]) : []),
        })).filter((m) => m.points.length >= 3);
        findings.push({ phrase, count: masks.length, masks });
      }
      return photoFindingsSchema.parse(findings);
    },
  };

  return { source: "meta", transcription, triage, analyst, vision };
}
