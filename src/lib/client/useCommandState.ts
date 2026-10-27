"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { getState } from "../server/service";

export type CommandState = Awaited<ReturnType<typeof getState>>;

/** Polls /api/state. Keeps the last good snapshot while reporting transient errors. */
export function useCommandState(intervalMs = 2000) {
  const [data, setData] = useState<CommandState | null>(null);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      await refresh();
      if (alive) timer.current = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}

export async function postJson<T = unknown>(url: string, body?: unknown): Promise<{ ok: boolean; data: T }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: r.ok, data: (await r.json().catch(() => ({}))) as T };
  } catch {
    return { ok: false, data: {} as T };
  }
}
