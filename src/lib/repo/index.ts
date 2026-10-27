import type { Repository } from "./Repository";
import { getRepository as getMemoryRepository } from "./memory";
import { SupabaseRepository } from "./supabase";

export type { Repository, SeenRecord } from "./Repository";
export { MemoryRepository } from "./memory";
export { SupabaseRepository } from "./supabase";

const g = globalThis as unknown as { __solarisRepo?: Repository; __solarisSupabaseRepo?: Repository };

/** True when both Supabase env vars are present (server-side only: the service-role key must never reach the browser). */
export function supabaseConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Repository selection:
 *  1. `globalThis.__solarisRepo`, when set, wins. This is the override the benchmark uses to run in an
 *     isolated in-memory state, and it is also the MemoryRepository singleton in memory mode.
 *  2. SupabaseRepository when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set (cached on globalThis,
 *     so it survives Next.js HMR like the memory singleton does).
 *  3. Otherwise the MemoryRepository singleton (runs with no credentials).
 */
export function getRepository(): Repository {
  if (g.__solarisRepo) return g.__solarisRepo;
  if (supabaseConfigured()) {
    g.__solarisSupabaseRepo ??= SupabaseRepository.fromEnv();
    return g.__solarisSupabaseRepo;
  }
  return getMemoryRepository();
}
