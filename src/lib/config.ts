/** Runtime configuration. All tunables come from the environment with safe defaults. */
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
};

export function ingestConfig(env: Record<string, string | undefined> = process.env) {
  return {
    /** Accepted clock skew / age of a message timestamp, in seconds. */
    replayWindowS: num(env.REPLAY_WINDOW_S, 600),
    /** Window in which the same message arriving by another path counts as a duplicate, not a replay. */
    dedupWindowS: num(env.DEDUP_WINDOW_S, 120),
    rateLimitMax: num(env.RATE_LIMIT_MAX, 5),
    rateLimitWindowMin: num(env.RATE_LIMIT_WINDOW_MIN, 10),
  };
}
export type IngestConfig = ReturnType<typeof ingestConfig>;
