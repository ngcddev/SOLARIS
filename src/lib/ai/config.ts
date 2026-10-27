/** Meta API configuration. Model IDs, URLs and parameters come from the environment, never from code paths. */
export function metaConfig(env: Record<string, string | undefined> = process.env) {
  return {
    // The docs call the variable MODEL_API_KEY; the hackathon brief uses META_API_KEY. Accept both.
    apiKey: env.META_API_KEY || env.MODEL_API_KEY || "",
    baseUrl: (env.META_BASE_URL || "https://api.meta.ai/v1").replace(/\/$/, ""),
    triageModel: env.META_TRIAGE_MODEL || "muse-spark-1.3",
    analystModel: env.META_ANALYST_MODEL || "muse-wonder-1.0",
    transcribeModel: env.META_TRANSCRIBE_MODEL || "muse-voice-transcribe-1.0",
    visionModel: env.META_VISION_MODEL || "sam-3.1",
    timeoutMs: Number(env.META_TIMEOUT_MS) || 15000,
  };
}
export type MetaConfig = ReturnType<typeof metaConfig>;

/**
 * Level 2: an open Meta model (Llama) served locally, e.g. with Ollama. Works with no internet.
 * Disabled unless LOCAL_LLM_URL is set.
 */
export function localConfig(env: Record<string, string | undefined> = process.env) {
  return {
    url: (env.LOCAL_LLM_URL || "").replace(/\/$/, ""),
    model: env.LOCAL_LLM_MODEL || "llama3.2:3b",
    timeoutMs: Number(env.LOCAL_LLM_TIMEOUT_MS) || 20000,
  };
}
export type LocalConfig = ReturnType<typeof localConfig>;

export const EMERGENCY_KEYWORDS = [
  "atrapado", "atrapados", "escombros", "sangrando", "herido", "bebé", "niño", "incendio", "derrumbe", "ayuda", "auxilio",
];
