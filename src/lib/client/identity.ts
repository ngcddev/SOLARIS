import { fromBase64, generateIdentity, toBase64, type SigningIdentity } from "../packet";

const KEY = "solaris.sim.identity";
let memory: SigningIdentity | null = null;

/** Ed25519 identity of this simulated "device". Persisted in localStorage when available (it may throw or be empty). */
export async function loadIdentity(): Promise<SigningIdentity> {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as { pk: string; sk: string };
      memory = { publicKey: fromBase64(j.pk), secretKey: fromBase64(j.sk) };
      return memory;
    }
  } catch {
    /* storage unavailable: fall through to a fresh in-memory identity */
  }
  memory = await generateIdentity();
  try {
    localStorage.setItem(KEY, JSON.stringify({ pk: toBase64(memory.publicKey), sk: toBase64(memory.secretKey) }));
  } catch {
    /* ignore */
  }
  return memory;
}

export async function newIdentity(): Promise<SigningIdentity> {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return loadIdentity();
}
