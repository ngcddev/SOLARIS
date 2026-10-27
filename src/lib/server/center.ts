import { CenterKeys, fromBase64, generateCenterKeys } from "../packet";

const g = globalThis as unknown as { __solarisCenter?: Promise<CenterKeys> };

/**
 * Command center key pair. Read from CENTER_PUBLIC_KEY / CENTER_SECRET_KEY (see `npm run keys`).
 * Without them an ephemeral pair is generated in memory so the demo runs with zero credentials.
 * Keys are never logged.
 */
export function getCenterKeys(): Promise<CenterKeys> {
  g.__solarisCenter ??= (async () => {
    const pub = process.env.CENTER_PUBLIC_KEY;
    const sec = process.env.CENTER_SECRET_KEY;
    if (pub && sec) return { publicKey: fromBase64(pub), secretKey: fromBase64(sec) };
    console.warn("[solaris] CENTER_*_KEY not set: using an ephemeral in-memory key pair (demo mode).");
    return generateCenterKeys();
  })();
  return g.__solarisCenter;
}
