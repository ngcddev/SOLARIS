import { photoFindingsSchema, analystJsonSchema, analystOutputSchema, triageJsonSchema, triageOutputSchema } from "./schemas";
import type { MetaConfig } from "./config";
import { EMERGENCY_KEYWORDS } from "./config";
import type { PhotoFinding } from "../domain/types";
import type { AnalystProvider, ProviderSet, TranscriptionProvider, TriageProvider, VisionProvider } from "./types";

/*
 * Real Meta Model API adapters. Everything marked VERIFICAR is an assumption taken from
 * https://dev.meta.ai/docs that could not be confirmed against live responses (no API credits yet).
 * See docs/ASSUMPTIONS.md. Any error or schema mismatch throws; the orchestrator then falls back to rules.
 */

const TRIAGE_SYSTEM =
  "Eres un asistente de coordinación para centros de mando de rescate tras un sismo. " +
  "Recibes un pedido de ayuda ya estructurado. Devuelve SOLO JSON según el esquema. " +
  "La 'justification' es una frase corta para el rescatista sobre logística y prioridad. " +
  "NUNCA des consejos médicos, instrucciones de primeros auxilios ni diagnósticos. " +
  "'coherence' (0 a 1) indica si el contenido es coherente y serio (bromas o contradicciones = valores bajos).";

const ANALYST_SYSTEM =
  "Eres el analista de un centro de mando de rescate. Recibes casos activos y equipos disponibles. " +
  "Propón una asignación (un equipo por caso, un caso por equipo) con justificación logística breve. " +
  "No des consejos médicos. La decisión final es del brigadista. Devuelve SOLO JSON según el esquema.";

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
async function structuredChat(cfg: MetaConfig, model: string, system: string, user: unknown, name: string, schema: object): Promise<unknown> {
  // VERIFICAR: response_format shape for structured output (OpenAI-style json_schema assumed).
  const res = await metaFetch(cfg, "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
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
      // VERIFICAR: POST /asr/transcribe multipart field names, keyword-biasing and language-hint parameters.
      const form = new FormData();
      form.append("model", cfg.transcribeModel);
      form.append("file", new Blob([audio as BlobPart], { type: "audio/wav" }), "sos.wav");
      form.append("language", language);
      form.append("keywords", (keywords.length ? keywords : EMERGENCY_KEYWORDS).join(","));
      const res = await metaFetch(cfg, "/asr/transcribe", { method: "POST", body: form });
      const data = (await res.json()) as { text?: string; turns?: { text: string }[] };
      // VERIFICAR: response carries `text` or turn-level `turns[]` (no word timestamps, no confidence score).
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
      // Wonder is expensive: only called on demand from the "Recomendar asignación" button.
      const raw = await structuredChat(cfg, cfg.analystModel, ANALYST_SYSTEM, input, "assignment", analystJsonSchema);
      return analystOutputSchema.parse(raw);
    },
  };

  const vision: VisionProvider = {
    async segment({ imageDataUrl, phrases }) {
      // VERIFICAR: SAM 3.1 through POST /responses with an input_image and one phrase per call; mask format.
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
        // VERIFICAR: normalised coordinates assumed; boxes are converted to rectangles.
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
