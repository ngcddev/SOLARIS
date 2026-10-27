import type { LocalConfig } from "./config";
import { triageJsonSchema, triageOutputSchema } from "./schemas";
import type { ProviderSet, TriageProvider } from "./types";

/**
 * Level 2: a local open Meta model (Llama) behind Ollama's HTTP API. No internet needed.
 * Only triage runs locally; transcription, vision and the analyst tasks fall back to rules.
 * Any error or schema mismatch throws and the orchestrator degrades to level-3 rules.
 */
const SYSTEM =
  "You are a coordination assistant for rescue command centers after an earthquake. " +
  "You receive an already-structured help request; free text may be in Spanish. Return ONLY JSON matching the schema. " +
  "The 'justification' is a short English sentence for the rescuer about logistics and priority. " +
  "NEVER give medical advice, first-aid instructions or diagnoses. " +
  "'coherence' (0 to 1) says whether the content is coherent and serious (jokes or contradictions = low values).";

export function localProviders(cfg: LocalConfig): ProviderSet {
  const triage: TriageProvider = {
    async triage(input) {
      // VERIFY: Ollama structured outputs: `format` accepts a JSON schema (Ollama >= 0.5).
      const res = await fetch(`${cfg.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(cfg.timeoutMs),
        body: JSON.stringify({
          model: cfg.model,
          stream: false,
          format: triageJsonSchema,
          options: { temperature: 0 },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: JSON.stringify(input) },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Local LLM HTTP ${res.status}`);
      const data = (await res.json()) as { message?: { content?: string } };
      const content = data.message?.content;
      if (!content) throw new Error("Local LLM: empty response");
      return triageOutputSchema.parse(JSON.parse(content));
    },
  };
  return { source: "local", triage };
}

/** Cheap reachability probe used by the UI badge. */
export async function probeLocalLlm(cfg: LocalConfig): Promise<boolean> {
  if (!cfg.url) return false;
  try {
    const res = await fetch(`${cfg.url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}
